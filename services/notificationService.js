import { env } from "../config/env.js";
import logger from "../config/logger.js";
import { ROLES, roleHasPermission } from "../config/roles.js";
import { EXCERPT_LENGTH, MAX_EMAILS_PER_HOUR, MAX_REVIEWER_FANOUT, NOTIFICATION_TYPES, TYPE_NAMES } from "../config/notifications.js";
import { getEmailProvider } from "../providers/email/index.js";
import { notificationTemplate } from "../providers/email/templates.js";
import { getQueue } from "../providers/queue/index.js";
import { findAuditLogById } from "../repositories/auditRepository.js";
import { findCommentById, findCommentsByIds } from "../repositories/commentRepository.js";
import {
    claimEmail,
    countEmailedSince,
    countUnread,
    createNotification,
    destroyOwnNotification,
    findInboxPage,
    findLatestRejectionIds,
    findNotificationByKey,
    findNotificationById,
    markRead as markReadRecords,
    releaseEmail,
} from "../repositories/notificationRepository.js";
import { findPreferencesOfUser, findPreferencesOfUsers, savePreferences } from "../repositories/notificationPreferenceRepository.js";
import { findPostById, findPostsByIds } from "../repositories/postRepository.js";
import { findActiveUsersWithRoles, findUserById, findUsersByIds } from "../repositories/userRepository.js";
import { canViewPost } from "../policies/postPolicy.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../utils/unsubscribeToken.js";
import { toAuthor } from "../utils/author.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Publishing an event (called from the places where things happen, after their transaction commits)
// ---------------------------------------------------------------------------------------------

// Hand an event to the queue. It carries ids and numbers only; who is told, and what they see, is worked out by
// the worker from the database. Never throws: telling people is a side effect of something that already succeeded,
// so if the queue is unreachable the event is logged and dropped.
export const publishEvent = async (event) => {
    try {
        await getQueue().add("notify", event);
    } catch (error) {
        logger.warn({ err: { message: error.message }, event: event.event }, "Could not queue a notification event");
    }
};

// ---------------------------------------------------------------------------------------------
// What each person wants
// ---------------------------------------------------------------------------------------------

const defaultsOf = (type) => ({ inApp: NOTIFICATION_TYPES[type].inApp, email: NOTIFICATION_TYPES[type].email });

// the choices of many people for one kind of notification: Map(userId -> { inApp, email })
const choicesFor = async (userIds, type) => {
    const rows = await findPreferencesOfUsers(userIds, type);
    const saved = new Map(rows.map((row) => [row.userId, { inApp: row.inApp, email: row.email }]));
    return new Map(userIds.map((id) => [id, saved.get(id) ?? defaultsOf(type)]));
};

const reviewerRoles = Object.values(ROLES).filter((role) => roleHasPermission(role, "post:review"));

// ---------------------------------------------------------------------------------------------
// The worker: turn an event into notifications
// ---------------------------------------------------------------------------------------------

// Candidates are { recipientId, actorId, type, postId, commentId, key }. Everyone who is active and wants the
// notification in at least one channel gets a row (the unique key makes a retried job harmless), and everyone who
// wants the email gets an email job. Returns how many rows were new.
const deliver = async (candidates) => {
    if (candidates.length === 0) return 0;
    const people = new Map((await findUsersByIds([...new Set(candidates.map((c) => c.recipientId))])).map((person) => [person.id, person]));
    const choices = new Map();
    for (const type of new Set(candidates.map((c) => c.type))) {
        const wanted = candidates.filter((c) => c.type === type).map((c) => c.recipientId);
        choices.set(type, await choicesFor([...new Set(wanted)], type));
    }

    let created = 0;
    for (const candidate of candidates) {
        const person = people.get(candidate.recipientId);
        // nobody is told about their own actions, and only active accounts are told anything
        if (!person || person.status !== "active" || candidate.actorId === candidate.recipientId) continue;
        const choice = choices.get(candidate.type).get(candidate.recipientId);
        if (!choice.inApp && !choice.email) continue;

        const dedupeKey = `${candidate.key}:${candidate.recipientId}`;
        let row;
        try {
            row = await createNotification({
                recipientId: candidate.recipientId,
                actorId: candidate.actorId ?? null,
                type: candidate.type,
                postId: candidate.postId ?? null,
                commentId: candidate.commentId ?? null,
                dedupeKey,
                note: candidate.note ?? null,
                inApp: choice.inApp,
            });
            created += 1;
        } catch (error) {
            if (error.name !== "SequelizeUniqueConstraintError") throw error;
            // this event was recorded before (the job is being retried): carry on, in case the email was never queued
            row = await findNotificationByKey(dedupeKey);
        }
        if (row && choice.email && !row.emailedAt) {
            await getQueue().add("notification-email", { notificationId: row.id });
        }
    }
    return created;
};

const toStatusCandidates = async (event) => {
    const post = await findPostById(event.postId);
    // the story moved on again since this event happened: there is nothing left to announce
    if (!post || post.status !== event.to) return [];

    if (event.to === "pending_review") {
        const reviewers = await findActiveUsersWithRoles(reviewerRoles, { excludeId: event.actorId, limit: MAX_REVIEWER_FANOUT });
        return reviewers.map((reviewer) => ({
            recipientId: reviewer.id,
            actorId: event.actorId,
            type: "post_submitted",
            postId: post.id,
            key: `post_submitted:${post.id}:${event.at}`,
        }));
    }
    if (event.to === "published" || event.to === "rejected") {
        const type = event.to === "published" ? "post_published" : "post_rejected";
        return [{ recipientId: post.userId, actorId: event.actorId, type, postId: post.id, key: `${type}:${post.id}:${event.at}` }];
    }
    return [];
};

const toCommentCandidates = async (event) => {
    const comment = await findCommentById(event.commentId);
    // deleted, or the story is no longer public: nobody needs to hear about it
    if (!comment || comment.deletedAt || comment.post.status !== "published") return [];

    const candidates = [];
    const key = `comment:${comment.id}`;
    let replyRecipient = null;
    if (comment.parentId) {
        const parent = await findCommentById(comment.parentId);
        if (parent && !parent.deletedAt) {
            replyRecipient = parent.userId;
            candidates.push({ recipientId: parent.userId, actorId: comment.userId, type: "comment_reply", postId: comment.postId, commentId: comment.id, key });
        }
    }
    // the story's author hears about a comment once: as a reply if it is a reply to their own comment
    if (comment.post.userId !== replyRecipient) {
        candidates.push({ recipientId: comment.post.userId, actorId: comment.userId, type: "comment_on_post", postId: comment.postId, commentId: comment.id, key });
    }
    return candidates;
};

// Something of someone's was removed by another person (a comment, or a story taken down). The moderator's note is
// read from the audit record, not carried in the job; a job whose audit row is not about this very thing is ignored.
const toRemovalCandidates = async (event) => {
    const audit = event.auditLogId ? await findAuditLogById(event.auditLogId) : null;
    if (!audit) return [];

    if (event.kind === "comment") {
        const comment = await findCommentById(event.commentId);
        if (!comment || audit.action !== "comment.deleted_by_other" || audit.entityId !== String(comment.id)) return [];
        return [
            {
                recipientId: comment.userId,
                actorId: event.actorId,
                type: "comment_removed",
                postId: comment.postId,
                commentId: comment.id,
                note: audit.metadata?.note ?? null,
                key: `comment_removed:${comment.id}`,
            },
        ];
    }
    if (event.kind === "post") {
        const post = await findPostById(event.postId);
        if (!post || audit.action !== "post.status_changed" || audit.entityId !== String(post.id)) return [];
        return [
            {
                recipientId: post.userId,
                actorId: event.actorId,
                type: "post_unpublished",
                postId: post.id,
                note: audit.metadata?.reason ?? null,
                key: `post_unpublished:${post.id}:${event.at}`,
            },
        ];
    }
    return [];
};

// The queue's "notify" job.
export const handleEvent = async (event) => {
    switch (event.event) {
        case "comment_created":
            return deliver(await toCommentCandidates(event));
        case "follow_created":
            return deliver([
                { recipientId: event.followingId, actorId: event.followerId, type: "new_follower", key: `follow:${event.followerId}:${event.followingId}` },
            ]);
        case "post_status_changed":
            return deliver(await toStatusCandidates(event));
        case "content_removed":
            return deliver(await toRemovalCandidates(event));
        case "post_published_on_schedule": {
            const post = await findPostById(event.postId);
            if (!post || post.status !== "published") return 0;
            return deliver([{ recipientId: post.userId, actorId: null, type: "post_published", postId: post.id, key: `post_published:${post.id}:${event.at}` }]);
        }
        default:
            logger.warn({ event: event.event }, "Unknown notification event");
            return 0;
    }
};

// ---------------------------------------------------------------------------------------------
// Reading notifications: what the recipient may be shown
// ---------------------------------------------------------------------------------------------

const excerptOf = (body) => (body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : body);

// Build what the recipient sees for many notifications with three queries in all (stories, comments, people).
// A notification is left out (null) when the story is no longer visible to them or the comment is gone, so a story
// that was made private, or a deleted comment, cannot be learned about from the inbox.
const describe = async (rows, recipient) => {
    const [posts, comments, actors] = await Promise.all([
        findPostsByIds([...new Set(rows.map((row) => row.postId).filter(Boolean))]),
        findCommentsByIds([...new Set(rows.map((row) => row.commentId).filter(Boolean))]),
        findUsersByIds([...new Set(rows.map((row) => row.actorId).filter(Boolean))], { withAvatar: true }),
    ]);
    const postById = new Map(posts.map((post) => [post.id, post]));
    const commentById = new Map(comments.map((comment) => [comment.id, comment]));
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));
    // a story sent back twice: only the newest notification carries the reason (it is the latest decision's)
    const latestRejection = await findLatestRejectionIds(
        recipient.id,
        rows.filter((row) => row.type === "post_rejected").map((row) => row.postId),
    );

    return rows.map((row) => {
        const post = row.postId ? postById.get(row.postId) : null;
        const comment = row.commentId ? commentById.get(row.commentId) : null;
        if (row.postId && (!post || !canViewPost(recipient, post))) return null;
        // a comment's notification disappears with the comment, except "your comment was removed", which is about exactly that
        const removal = row.type === "comment_removed";
        if (row.commentId && !removal && (!comment || comment.deletedAt || post?.status !== "published")) return null;
        return {
            id: row.id,
            type: row.type,
            actor: row.actorId ? toAuthor(actorById.get(row.actorId)) : null,
            post: post ? { id: post.id, slug: post.slug, title: post.title } : null,
            comment: comment && !removal ? { id: comment.id, parentId: comment.parentId, excerpt: excerptOf(comment.body ?? "") } : null,
            ...(row.note && { note: row.note }),
            ...(row.type === "post_rejected" && post?.status === "rejected" && post.rejectionReason && latestRejection.get(row.postId) === row.id && { reason: post.rejectionReason }),
            readAt: row.readAt,
            createdAt: row.createdAt,
        };
    });
};

export const listNotifications = async (user, { page, limit, unreadOnly }) => {
    const { rows, count } = await findInboxPage({ recipientId: user.id, unreadOnly, limit, offset: (page - 1) * limit });
    const [shown, unread] = await Promise.all([describe(rows, user), countUnread(user.id)]);
    return {
        notifications: shown.filter(Boolean),
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
        unreadCount: unread,
    };
};

export const getUnreadCount = async (user) => ({ unreadCount: await countUnread(user.id) });

// ids: the notifications to mark, or null for all of them; other people's ids are not matched
export const markRead = async (user, ids) => ({ updated: await markReadRecords(user.id, ids), ...(await getUnreadCount(user)) });

export const dismiss = async (user, id) => {
    if ((await destroyOwnNotification(id, user.id)) === 0) throw new NotFoundError("Notification not found");
};

// ---------------------------------------------------------------------------------------------
// Preferences and unsubscribing
// ---------------------------------------------------------------------------------------------

// the kinds this person can receive (review requests only exist for editors and admins)
const typesFor = (user) => TYPE_NAMES.filter((type) => !NOTIFICATION_TYPES[type].reviewers || roleHasPermission(user.role, "post:review"));

export const getPreferences = async (user) => {
    const saved = new Map((await findPreferencesOfUser(user.id)).map((row) => [row.type, row]));
    return typesFor(user).map((type) => ({
        type,
        label: NOTIFICATION_TYPES[type].label,
        inApp: saved.get(type)?.inApp ?? NOTIFICATION_TYPES[type].inApp,
        email: saved.get(type)?.email ?? NOTIFICATION_TYPES[type].email,
    }));
};

export const setPreferences = async (user, items) => {
    const allowed = new Set(typesFor(user));
    for (const item of items) {
        if (!allowed.has(item.type)) throw new ValidationError(`Unknown notification type: ${item.type}`);
    }
    await savePreferences(user.id, items);
    return getPreferences(user);
};

// The link in an email: turns that kind of email off (or every kind, scope "all"). In-app choices are untouched.
export const unsubscribe = async (token) => {
    const verified = verifyUnsubscribeToken(token);
    if (!verified) throw new ValidationError("This unsubscribe link is not valid or has expired");
    const user = await findUserById(verified.userId);
    if (!user || user.status === "deleted") throw new ValidationError("This unsubscribe link is not valid or has expired");

    const current = new Map((await getPreferences(user)).map((item) => [item.type, item]));
    const types = verified.scope === "all" ? [...current.keys()] : [verified.scope];
    const changes = types.filter((type) => current.has(type)).map((type) => ({ type, inApp: current.get(type).inApp, email: false }));
    if (changes.length > 0) await savePreferences(user.id, changes);
    return { scope: verified.scope, label: verified.scope === "all" ? "All notification" : NOTIFICATION_TYPES[verified.scope].label };
};

// ---------------------------------------------------------------------------------------------
// The worker: send the email for one notification
// ---------------------------------------------------------------------------------------------

// What the email says and where it points, from what the inbox would show.
const emailContent = (view) => {
    const who = view.actor?.username ?? "Someone";
    const title = view.post?.title ?? "your story";
    const quoted = `“${title}”`;
    switch (view.type) {
        case "comment_on_post":
            return { headline: `${who} commented on ${quoted}`, detail: view.comment?.excerpt, path: `/blog/${view.post.slug}#comments` };
        case "comment_reply":
            return { headline: `${who} replied to your comment on ${quoted}`, detail: view.comment?.excerpt, path: `/blog/${view.post.slug}#comments` };
        case "new_follower":
            return { headline: `${who} started following you`, path: `/u/${encodeURIComponent(view.actor?.username ?? "")}` };
        case "post_submitted":
            return { headline: `${who} submitted ${quoted} for review`, path: "/review" };
        case "post_published":
            return { headline: `${quoted} is now published`, path: `/blog/${view.post.slug}` };
        case "post_rejected":
            return { headline: `${quoted} was sent back for changes`, detail: view.reason, path: `/posts/${view.post.id}/edit` };
        case "comment_removed":
            return { headline: `Your comment on ${quoted} was removed`, detail: view.note, path: `/blog/${view.post.slug}#comments` };
        case "post_unpublished":
            return { headline: `${quoted} was taken down`, detail: view.note, path: `/posts/${view.post.id}` };
        default:
            return null;
    }
};

// The queue's "notification-email" job. Safe to run twice: the claim lets exactly one run send it, and a send that
// fails gives the claim back (and throws, so the queue tries again). A crash between claiming and sending would
// lose that one email, which is the price of never sending one twice.
export const handleEmail = async ({ notificationId }) => {
    const row = await findNotificationById(notificationId);
    if (!row || row.emailedAt) return "skipped";

    const user = await findUserById(row.recipientId);
    if (!user || user.status !== "active" || !user.emailVerifiedAt) return "skipped";
    const choice = (await choicesFor([user.id], row.type)).get(user.id);
    if (!choice.email) return "skipped";
    // a person cannot be flooded with email: past the limit they still have the inbox
    if ((await countEmailedSince(user.id, new Date(Date.now() - HOUR_MS))) >= MAX_EMAILS_PER_HOUR) return "skipped";

    const [view] = await describe([row], user);
    const content = view && emailContent(view);
    if (!content) return "skipped";

    if (!(await claimEmail(row.id))) return "skipped";
    const unsubscribeUrl = `${env.APP_URL}/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(user.id, row.type))}`;
    const oneClickUrl = `${env.APP_URL}/api/notifications/unsubscribe?token=${encodeURIComponent(signUnsubscribeToken(user.id, row.type))}`;
    try {
        await getEmailProvider().send({
            to: user.email,
            ...notificationTemplate({
                firstName: user.firstName,
                headline: content.headline,
                detail: content.detail,
                url: `${env.APP_URL}${content.path}`,
                unsubscribeUrl,
                unsubscribeLabel: NOTIFICATION_TYPES[row.type].label,
            }),
            headers: { "List-Unsubscribe": `<${oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
    } catch (error) {
        await releaseEmail(row.id);
        throw error;
    }
    return "sent";
};
