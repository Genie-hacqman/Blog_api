import { findUserById, lockActiveAdmins, updateUserById } from "../repositories/userRepository.js";
import { revokeAllForUser } from "../repositories/refreshTokenRepository.js";
import { countOpenReportsAbout } from "../repositories/reportRepository.js";
import {
    countCommentsBy,
    countCommentsSince,
    countLiveComments,
    countPostsBy,
    countPostsByStatus,
    countPostsPublishedSince,
    countUsersByRole,
    countUsersByStatus,
    countUsersCreatedSince,
    searchUsers,
} from "../repositories/adminRepository.js";
import { countOpenTargets } from "../repositories/reportRepository.js";
import { withTransaction } from "../database/transaction.js";
import { recordAudit, getAuditLogs } from "./auditService.js";
import { sendAccountReinstatedEmail, sendAccountSuspendedEmail } from "./emailService.js";
import { sanitizeUser } from "./userService.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/AppError.js";

// Change someone's role. Runs in one transaction with the audit row, and with every active
// admin row locked, so two admins demoting each other at the same moment cannot leave the
// system with no admin.
export const setUserRole = async (actor, targetId, role, context) => {
    return withTransaction(async (transaction) => {
        const admins = await lockActiveAdmins({ transaction });

        // the actor was an admin when the request was authenticated; make sure they still are
        if (!admins.some((admin) => admin.id === actor.id)) {
            throw new ForbiddenError();
        }
        if (Number(targetId) === actor.id) {
            throw new ForbiddenError("You cannot change your own role");
        }

        const target = await findUserById(targetId, { transaction, withAvatar: true });
        if (!target || target.status === "deleted") {
            throw new NotFoundError("User not found");
        }
        if (target.role === role) {
            return sanitizeUser(target);
        }
        if (target.role === "admin" && admins.length < 2) {
            throw new ForbiddenError("Cannot demote the last admin");
        }

        await updateUserById(target.id, { role }, { transaction });
        await recordAudit(
            { actorId: actor.id, action: "user.role_changed", entityType: "user", entityId: target.id, metadata: { from: target.role, to: role } },
            { context, transaction },
        );

        return sanitizeUser({ ...target.get(), role });
    });
};

// ---------- accounts ----------

// an account as an admin sees it (they may see the email address and why it was suspended)
const toAdminUser = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    suspendedAt: user.suspendedAt,
    suspendedReason: user.suspendedReason,
});

export const listUsers = async ({ q, role, status, verified, page, limit }) => {
    const { rows, count } = await searchUsers({ q, role, status, verified, limit, offset: (page - 1) * limit });
    return { users: rows.map(toAdminUser), pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
};

export const getUserDetail = async (id) => {
    const user = await findUserById(id);
    if (!user || user.status === "deleted") throw new NotFoundError("User not found");
    const [posts, comments, reportsAgainst] = await Promise.all([countPostsBy(id), countCommentsBy(id), countOpenReportsAbout(id)]);
    return { ...toAdminUser(user), counts: { posts, comments, openReports: reportsAgainst } };
};

// Suspend an account, inside the caller's transaction (the moderation queue uses it too). All active admins are
// locked first, so two admins suspending each other at the same moment cannot leave the site with none.
// Returns { user, auditId, afterCommit }: call afterCommit() once the transaction has committed (it emails the person).
export const suspendWithin = async (transaction, actor, targetId, reason, context) => {
    const admins = await lockActiveAdmins({ transaction });
    if (!admins.some((admin) => admin.id === actor.id)) throw new ForbiddenError();
    if (Number(targetId) === actor.id) throw new ForbiddenError("You cannot suspend yourself");

    const target = await findUserById(targetId, { transaction });
    if (!target || target.status === "deleted") throw new NotFoundError("User not found");
    if (target.status === "suspended") throw new ConflictError("This account is already suspended");
    if (target.role === "admin" && admins.length < 2) throw new ForbiddenError("Cannot suspend the last admin");

    await updateUserById(target.id, { status: "suspended", suspendedAt: new Date(), suspendedReason: reason }, { transaction });
    // every session ends now (the per-request status check already refuses them; this also stops refreshing)
    await revokeAllForUser(target.id, { transaction });
    const audit = await recordAudit(
        { actorId: actor.id, action: "user.suspended", entityType: "user", entityId: target.id, metadata: { reason } },
        { context, transaction },
    );
    return { user: target, auditId: audit.id, afterCommit: () => sendAccountSuspendedEmail(target, reason) };
};

export const suspendUser = async (actor, targetId, reason, context) => {
    const { user, afterCommit } = await withTransaction((transaction) => suspendWithin(transaction, actor, targetId, reason, context));
    void afterCommit();
    return toAdminUser({ ...user.get(), status: "suspended", suspendedAt: new Date(), suspendedReason: reason });
};

export const unsuspendUser = async (actor, targetId, context) => {
    const target = await withTransaction(async (transaction) => {
        const user = await findUserById(targetId, { transaction });
        if (!user || user.status === "deleted") throw new NotFoundError("User not found");
        if (user.status !== "suspended") throw new ConflictError("This account is not suspended");
        await updateUserById(user.id, { status: "active", suspendedAt: null, suspendedReason: null }, { transaction });
        await recordAudit({ actorId: actor.id, action: "user.unsuspended", entityType: "user", entityId: user.id }, { context, transaction });
        return user;
    });
    void sendAccountReinstatedEmail(target);
    return toAdminUser({ ...target.get(), status: "active", suspendedAt: null, suspendedReason: null });
};

// end every session of an account (it can log in again): for a lost device, or while looking into something
export const signOutEverywhere = async (actor, targetId, context) => {
    return withTransaction(async (transaction) => {
        const user = await findUserById(targetId, { transaction });
        if (!user || user.status === "deleted") throw new NotFoundError("User not found");
        const sessions = await revokeAllForUser(user.id, { transaction });
        await recordAudit({ actorId: actor.id, action: "user.sessions_revoked", entityType: "user", entityId: user.id, metadata: { sessions } }, { context, transaction });
        return { sessions };
    });
};

// ---------- overview ----------

const DAY_MS = 24 * 60 * 60 * 1000;

// Counts only (the reading figures and trends are for the analytics phase). Every number is one grouped query.
export const getDashboard = async () => {
    const now = Date.now();
    const [byStatus, byRole, postsByStatus, week, month, publishedMonth, comments, commentsWeek, openTargets, recent] = await Promise.all([
        countUsersByStatus(),
        countUsersByRole(),
        countPostsByStatus(),
        countUsersCreatedSince(new Date(now - 7 * DAY_MS)),
        countUsersCreatedSince(new Date(now - 30 * DAY_MS)),
        countPostsPublishedSince(new Date(now - 30 * DAY_MS)),
        countLiveComments(),
        countCommentsSince(new Date(now - 7 * DAY_MS)),
        countOpenTargets(["post", "comment", "user"]),
        getAuditLogs({ page: 1, limit: 8 }),
    ]);
    const sum = (counts) => Object.values(counts).reduce((total, n) => total + n, 0);
    return {
        users: {
            total: sum(byStatus) - (byStatus.deleted ?? 0),
            active: byStatus.active ?? 0,
            suspended: byStatus.suspended ?? 0,
            deleted: byStatus.deleted ?? 0,
            byRole: { user: byRole.user ?? 0, author: byRole.author ?? 0, editor: byRole.editor ?? 0, admin: byRole.admin ?? 0 },
            newLast7Days: week,
            newLast30Days: month,
        },
        posts: { total: sum(postsByStatus), byStatus: postsByStatus, publishedLast30Days: publishedMonth },
        comments: { total: comments, last7Days: commentsWeek },
        reports: { openTargets },
        reviewQueue: postsByStatus.pending_review ?? 0,
        recentActivity: recent.logs,
    };
};
