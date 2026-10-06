import { MAX_COMMENTS_PER_HOUR, MAX_COMMENT_LENGTH } from "../config/engagement.js";
import {
    countCommentsByUserSince,
    countRepliesFor,
    createComment as createCommentRecord,
    findCommentById,
    findRepliesPage,
    findTopLevelPage,
    softDeleteComment,
    updateCommentBody,
} from "../repositories/commentRepository.js";
import { findPostById } from "../repositories/postRepository.js";
import { withTransaction } from "../database/transaction.js";
import { canDeleteComment, canEditComment, deletionCapacity } from "../policies/commentPolicy.js";
import { recordAudit } from "./auditService.js";
import { publishEvent } from "./notificationService.js";
import { toAuthor } from "../utils/author.js";
import { ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError } from "../utils/AppError.js";

const HOUR_MS = 60 * 60 * 1000;

const pagination = (page, limit, count) => ({ page, limit, total: count, totalPages: Math.ceil(count / limit) });

// A comment as the viewer sees it. A deleted one is a placeholder: no words, no author.
// `post` is the post it is on (the rules for who may delete need its author).
const toCommentDto = (comment, viewer, post, replyCount = 0) => {
    const deleted = Boolean(comment.deletedAt);
    return {
        id: comment.id,
        postId: comment.postId,
        parentId: comment.parentId,
        body: deleted ? null : comment.body,
        author: deleted ? null : toAuthor(comment.author),
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        replyCount,
        deleted,
        canEdit: canEditComment(viewer, comment),
        canDelete: canDeleteComment(viewer, comment, post),
    };
};

// Comments live on published posts only. A post that is not published (or does not exist) is "not found" to
// everyone, its author included, so a comment cannot be used to find out about hidden posts.
const publishedPostOrNotFound = async (postId) => {
    const post = await findPostById(postId);
    if (!post || post.status !== "published") throw new NotFoundError("Post not found");
    return post;
};

// a comment that is on a post which is public right now, or "not found"
const visibleCommentOrNotFound = async (commentId) => {
    const comment = await findCommentById(commentId);
    if (!comment || comment.post.status !== "published") throw new NotFoundError("Comment not found");
    return comment;
};

// Control characters (except line breaks and tabs) and the invisible "bidirectional override" characters
// that can make text read differently from how it is stored are removed; runs of blank lines are shortened.
const isAllowedChar = (char) => {
    const code = char.codePointAt(0);
    if (code === 9 || code === 10) return true; // tab, line feed
    if (code < 32 || code === 127) return false; // other control characters
    if (code >= 0x202a && code <= 0x202e) return false; // bidi embeddings and overrides
    if (code >= 0x2066 && code <= 0x2069) return false; // bidi isolates
    return true;
};

export const cleanBody = (input) => {
    const text = [...String(input ?? "").replace(/\r\n?/g, "\n")]
        .filter(isAllowedChar)
        .join("")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    if (!text) throw new ValidationError("comment is required");
    if (text.length > MAX_COMMENT_LENGTH) throw new ValidationError(`comment must be at most ${MAX_COMMENT_LENGTH} characters`);
    return text;
};

export const listComments = async (postId, viewer, { page, limit }) => {
    const post = await publishedPostOrNotFound(postId);
    const { rows, count } = await findTopLevelPage({ postId: post.id, limit, offset: (page - 1) * limit });
    const replyCounts = await countRepliesFor(rows.map((row) => row.id));
    return {
        comments: rows.map((row) => toCommentDto(row, viewer, post, replyCounts.get(row.id) ?? 0)),
        pagination: pagination(page, limit, count),
    };
};

export const listReplies = async (commentId, viewer, { page, limit }) => {
    const parent = await visibleCommentOrNotFound(commentId);
    // only top-level comments have replies; a reply's id is "not found" here
    if (parent.parentId !== null) throw new NotFoundError("Comment not found");
    const { rows, count } = await findRepliesPage({ parentId: parent.id, limit, offset: (page - 1) * limit });
    return { comments: rows.map((row) => toCommentDto(row, viewer, parent.post)), pagination: pagination(page, limit, count) };
};

export const createComment = async (user, postId, { body, parentId = null }) => {
    const post = await publishedPostOrNotFound(postId);
    const text = cleanBody(body);

    if ((await countCommentsByUserSince(user.id, new Date(Date.now() - HOUR_MS))) >= MAX_COMMENTS_PER_HOUR) {
        throw new TooManyRequestsError("You have reached the hourly comment limit. Try again later.");
    }

    // a reply goes under a top-level, living comment of this very post (one level of replies)
    if (parentId !== null) {
        const parent = await findCommentById(parentId);
        if (!parent || parent.postId !== post.id || parent.parentId !== null || parent.deletedAt) {
            throw new ValidationError("You can only reply to a comment on this story");
        }
    }

    const created = await createCommentRecord({ postId: post.id, userId: user.id, parentId, body: text });
    // tell the people it concerns (the story's author, the author of the comment replied to); never holds up the response
    void publishEvent({ event: "comment_created", commentId: created.id });
    return toCommentDto(created, user, post);
};

export const editComment = async (commentId, user, { body }) => {
    const comment = await visibleCommentOrNotFound(commentId);
    if (comment.deletedAt) throw new NotFoundError("Comment not found");
    if (!canEditComment(user, comment)) throw new ForbiddenError("You can only edit your own comments");

    const text = cleanBody(body);
    // the same words again are a success that changes nothing (no "edited" mark)
    if (text !== comment.body && (await updateCommentBody(comment.id, text, new Date())) === 0) {
        throw new NotFoundError("Comment not found");
    }
    return toCommentDto(await findCommentById(comment.id), user, comment.post);
};

// The deletion itself, inside the caller's transaction: soft delete, and (when someone other than the author does it)
// the audit row, which carries the moderator's note. Returns the audit row's id, or null for an author deleting their own.
// Used by the delete endpoint and by the moderation queue.
export const deleteWithin = async (transaction, comment, user, context, note = null) => {
    if ((await softDeleteComment(comment.id, { transaction })) === 0) throw new NotFoundError("Comment not found");
    if (comment.userId === user.id) return null;
    const audit = await recordAudit(
        {
            actorId: user.id,
            action: "comment.deleted_by_other",
            entityType: "comment",
            entityId: comment.id,
            metadata: { postId: comment.postId, authorId: comment.userId, as: deletionCapacity(user, comment.post), ...(note && { note }) },
        },
        { context, transaction },
    );
    return audit.id;
};

// tell a comment's author it was removed by someone else (after the removal committed)
export const announceRemoval = (comment, user, auditId) => {
    if (auditId) void publishEvent({ event: "content_removed", kind: "comment", commentId: comment.id, actorId: user.id, auditLogId: auditId, at: Date.now() });
};

// Soft delete. The author, the author of the post, and editors may do it; when someone other than the
// comment's author does, the action is audited (in the same transaction, so the record cannot be skipped)
// with the optional note, and the author is told.
export const deleteComment = async (commentId, user, context, note = null) => {
    const comment = await visibleCommentOrNotFound(commentId);
    if (comment.deletedAt) throw new NotFoundError("Comment not found");
    if (!canDeleteComment(user, comment, comment.post)) throw new ForbiddenError("You cannot delete this comment");

    const auditId = await withTransaction((transaction) => deleteWithin(transaction, comment, user, context, note));
    announceRemoval(comment, user, auditId);
};
