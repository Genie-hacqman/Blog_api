import { ACTIONS_FOR, MAX_REPORTS_PER_HOUR, REPORT_REASONS, REPORT_STATUS, RESOLVED_STATUSES } from "../config/moderation.js";
import {
    countReasonsFor,
    countReportsBySince,
    createReport as createReportRecord,
    findGroupedPage,
    findLastHandledFor,
    findReportById,
    findReportsOfTarget,
    resolveOpenReports,
} from "../repositories/reportRepository.js";
import { findCommentById, findCommentsByIds } from "../repositories/commentRepository.js";
import { findPostById, findPostsByIds } from "../repositories/postRepository.js";
import { findUserByUsername, findUsersByIds } from "../repositories/userRepository.js";
import { withTransaction } from "../database/transaction.js";
import { reportTypesFor } from "../policies/reportPolicy.js";
import { suspendWithin } from "./adminService.js";
import { recordAudit } from "./auditService.js";
import { announceRemoval, deleteWithin } from "./commentService.js";
import { announceStatusChange, moveStatus } from "./postStatusService.js";
import { toAuthor } from "../utils/author.js";
import { AppError, NotFoundError, TooManyRequestsError, ValidationError } from "../utils/AppError.js";

const HOUR_MS = 60 * 60 * 1000;
const EXCERPT_LENGTH = 300;

// ---------- filing a report ----------

const ownContent = () => new AppError(400, "CANNOT_REPORT_OWN", "You cannot report your own content");

// What is being reported, as the ids to store. Anything the public cannot see (a draft, an unpublished story, a
// deleted comment, a suspended account) is "not found": a report must never be a way to find out about hidden things.
const resolveTarget = async (reporter, targetType, targetId) => {
    if (targetType === "post") {
        const post = Number.isInteger(targetId) ? await findPostById(targetId) : null;
        if (!post || post.status !== "published") throw new NotFoundError("Story not found");
        if (post.userId === reporter.id) throw ownContent();
        return { postId: post.id, targetKey: `post:${post.id}` };
    }
    if (targetType === "comment") {
        const comment = Number.isInteger(targetId) ? await findCommentById(targetId) : null;
        if (!comment || comment.deletedAt || comment.post.status !== "published") throw new NotFoundError("Comment not found");
        if (comment.userId === reporter.id) throw ownContent();
        return { commentId: comment.id, targetKey: `comment:${comment.id}` };
    }
    const person = typeof targetId === "string" ? await findUserByUsername(targetId) : null;
    if (!person || person.status !== "active") throw new NotFoundError("User not found");
    if (person.id === reporter.id) throw ownContent();
    return { targetUserId: person.id, targetKey: `user:${person.id}` };
};

export const createReport = async (reporter, { targetType, targetId, reason, details = null }) => {
    const target = await resolveTarget(reporter, targetType, targetId);

    if ((await countReportsBySince(reporter.id, new Date(Date.now() - HOUR_MS))) >= MAX_REPORTS_PER_HOUR) {
        throw new TooManyRequestsError("You have filed a lot of reports in the last hour. Try again later.");
    }

    try {
        const report = await createReportRecord({ reporterId: reporter.id, targetType, ...target, reason, details });
        return { id: report.id, targetType, reason, status: report.status, createdAt: report.createdAt };
    } catch (error) {
        if (error.name === "SequelizeUniqueConstraintError") {
            throw new AppError(409, "ALREADY_REPORTED", "You have already reported this");
        }
        throw error;
    }
};

// ---------- the queue ----------

const parseKey = (targetKey) => {
    const [type, id] = targetKey.split(":");
    return { type, id: Number(id) };
};

// A short, safe description of each target (a missing one, such as a story deleted since, comes back as null).
const describeTargets = async (keys) => {
    const wanted = { post: new Set(), comment: new Set(), user: new Set() };
    for (const key of keys) {
        const { type, id } = parseKey(key);
        wanted[type]?.add(id);
    }
    const comments = await findCommentsByIds([...wanted.comment]);
    const postIds = new Set([...wanted.post, ...comments.map((comment) => comment.postId)]);
    const posts = await findPostsByIds([...postIds]);
    const people = await findUsersByIds(
        [...new Set([...wanted.user, ...posts.map((post) => post.userId), ...comments.map((comment) => comment.userId)])],
        { withAvatar: true },
    );
    const postById = new Map(posts.map((post) => [post.id, post]));
    const commentById = new Map(comments.map((comment) => [comment.id, comment]));
    const personById = new Map(people.map((person) => [person.id, person]));
    const story = (post) => (post ? { id: post.id, slug: post.slug, title: post.title, status: post.status } : null);

    return new Map(
        keys.map((key) => {
            const { type, id } = parseKey(key);
            if (type === "post") {
                const post = postById.get(id);
                return [key, post && { ...story(post), author: toAuthor(personById.get(post.userId)) }];
            }
            if (type === "comment") {
                const comment = commentById.get(id);
                return [
                    key,
                    comment && {
                        id: comment.id,
                        removed: Boolean(comment.deletedAt),
                        excerpt: comment.deletedAt ? null : String(comment.body).slice(0, EXCERPT_LENGTH),
                        author: toAuthor(personById.get(comment.userId)),
                        post: story(postById.get(comment.postId)),
                    },
                ];
            }
            const person = personById.get(id);
            return [key, person && { id: person.id, username: person.username, status: person.status, role: person.role }];
        }),
    );
};

const labelled = (reasons = []) => reasons.map(({ reason, count }) => ({ reason, label: REPORT_REASONS[reason] ?? reason, count }));

// One entry per reported target: what it is, how many people reported it and why, and (when resolved) how it ended.
const buildItems = async (groups, statuses) => {
    const keys = groups.map((group) => group.targetKey);
    const [targets, reasons, handled] = await Promise.all([
        describeTargets(keys),
        countReasonsFor(keys, statuses),
        statuses.includes(REPORT_STATUS.OPEN) ? new Map() : findLastHandledFor(keys),
    ]);
    return groups.map((group) => {
        const last = handled.get(group.targetKey);
        const { type } = parseKey(group.targetKey);
        return {
            id: group.id,
            targetType: type,
            status: last?.status ?? REPORT_STATUS.OPEN,
            reportCount: Number(group.reportCount),
            reasons: labelled(reasons.get(group.targetKey)),
            lastReportedAt: group.lastReportedAt,
            target: targets.get(group.targetKey) ?? null,
            ...(last && {
                handled: { by: last.handler?.username ?? null, at: last.handledAt, outcome: last.status, note: last.resolutionNote },
            }),
        };
    });
};

export const listQueue = async (viewer, { status, type, page, limit }) => {
    const allowed = reportTypesFor(viewer.role);
    const types = type ? allowed.filter((candidate) => candidate === type) : allowed;
    const statuses = status === "resolved" ? [...RESOLVED_STATUSES] : [REPORT_STATUS.OPEN];
    if (types.length === 0) return { items: [], pagination: { page, limit, total: 0, totalPages: 0 } };

    const { rows, total } = await findGroupedPage({ statuses, types, limit, offset: (page - 1) * limit });
    return { items: await buildItems(rows, statuses), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// one reported target in full, with every report about it (who filed each, and what they wrote): for moderators only
export const getReportDetail = async (viewer, id) => {
    const report = await findReportById(id);
    if (!report || !reportTypesFor(viewer.role).includes(report.targetType)) throw new NotFoundError("Report not found");

    const open = report.status === REPORT_STATUS.OPEN;
    const statuses = open ? [REPORT_STATUS.OPEN] : [...RESOLVED_STATUSES];
    const reports = await findReportsOfTarget(report.targetKey, statuses);
    const [item] = await buildItems([{ id: report.id, targetKey: report.targetKey, reportCount: reports.length, lastReportedAt: reports[0]?.createdAt ?? report.createdAt }], statuses);
    return {
        ...item,
        reports: reports.map((row) => ({
            id: row.id,
            reporter: row.reporter ? { id: row.reporter.id, username: row.reporter.username } : null,
            reason: row.reason,
            label: REPORT_REASONS[row.reason] ?? row.reason,
            details: row.details,
            createdAt: row.createdAt,
        })),
    };
};

// ---------- deciding ----------

// One decision per target: it closes every open report about it. Everything that changes (the comment, the story,
// the account, the reports, the audit rows) commits together, and the people concerned are told afterwards.
export const resolveReport = async (viewer, id, { action, note }, context) => {
    const report = await findReportById(id);
    if (!report || !reportTypesFor(viewer.role).includes(report.targetType)) throw new NotFoundError("Report not found");
    if (!ACTIONS_FOR[report.targetType].includes(action)) {
        throw new ValidationError(`That action does not apply to a report about a ${report.targetType === "post" ? "story" : report.targetType}`);
    }
    const text = (note ?? "").trim();
    if (action !== "dismiss" && !text) throw new ValidationError("A note is required for this action");

    const afterCommit = [];
    await withTransaction(async (transaction) => {
        const locked = await findReportById(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!locked || locked.status !== REPORT_STATUS.OPEN) {
            throw new AppError(409, "ALREADY_RESOLVED", "This report was already handled");
        }

        if (action === "remove") {
            const comment = await findCommentById(locked.commentId, { transaction });
            // already gone (its author deleted it meanwhile): nothing left to remove, the reports are still closed
            if (comment && !comment.deletedAt) {
                const auditId = await deleteWithin(transaction, comment, viewer, context, text);
                afterCommit.push(() => announceRemoval(comment, viewer, auditId));
            }
        } else if (action === "unpublish") {
            const post = await findPostById(locked.postId, { transaction });
            if (post?.status === "published") {
                const input = { to: "archived", reason: text };
                const now = new Date();
                const moved = await moveStatus(transaction, locked.postId, viewer, input, context, now);
                afterCommit.push(() => announceStatusChange({ id: locked.postId, post: moved.post, user: viewer, input, auditId: moved.auditId, now }));
            }
        } else if (action === "suspend") {
            const suspension = await suspendWithin(transaction, viewer, locked.targetUserId, text, context);
            afterCommit.push(suspension.afterCommit);
        }

        const closed = await resolveOpenReports(
            locked.targetKey,
            { status: action === "dismiss" ? REPORT_STATUS.DISMISSED : REPORT_STATUS.ACTIONED, handledBy: viewer.id, note: text || null },
            { transaction },
        );
        await recordAudit(
            {
                actorId: viewer.id,
                action: "report.resolved",
                entityType: "report",
                entityId: locked.id,
                metadata: { action, targetType: locked.targetType, targetKey: locked.targetKey, reports: closed, ...(text && { note: text }) },
            },
            { context, transaction },
        );
    });
    for (const run of afterCommit) void run();

    return getReportDetail(viewer, id);
};
