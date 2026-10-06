import { findPostById, lockPostById, transitionPost } from "../repositories/postRepository.js";
import { findLatestRevision } from "../repositories/postRevisionRepository.js";
import { withTransaction } from "../database/transaction.js";
import { canViewPost } from "../policies/postPolicy.js";
import { evaluateTransition } from "../policies/postWorkflow.js";
import { recordAudit } from "./auditService.js";
import { toPostDto } from "./postService.js";
import { attachPostData } from "./engagementService.js";
import { publishEvent } from "./notificationService.js";
import { MAX_SCHEDULE_AHEAD_MS, MIN_SCHEDULE_LEAD_MS } from "../config/posts.js";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../utils/AppError.js";

// the new column values for each target status
const changesFor = ({ post, to, user, publishAt, reason, now }) => {
    // approving or rejecting is a review decision and is recorded as one
    const review = post.status === "pending_review" ? { reviewedBy: user.id, reviewedAt: now } : {};

    switch (to) {
        case "published":
            // the first publication time sticks, even if the post is unpublished and published again
            return { status: to, publishedAt: post.publishedAt ?? now, scheduledAt: null, rejectionReason: null, ...review };
        case "scheduled":
            return { status: to, scheduledAt: publishAt, rejectionReason: null, ...review };
        case "rejected":
            return { status: to, rejectionReason: reason, reviewedBy: user.id, reviewedAt: now };
        case "pending_review":
            return { status: to, rejectionReason: null, reviewedBy: null, reviewedAt: null };
        default: // draft, private, archived
            return { status: to, scheduledAt: null };
    }
};

const checkInputs = ({ to, publishAt, reason }, now) => {
    if (to === "scheduled") {
        if (!publishAt) throw new ValidationError("publishAt is required to schedule a post");
        const lead = publishAt.getTime() - now.getTime();
        if (lead < MIN_SCHEDULE_LEAD_MS) throw new ValidationError("publishAt must be at least a minute in the future");
        if (lead > MAX_SCHEDULE_AHEAD_MS) throw new ValidationError("publishAt cannot be more than a year ahead");
    } else if (publishAt) {
        throw new ValidationError('publishAt only applies when moving a post to "scheduled"');
    }
    if (to === "rejected" && !reason) {
        throw new ValidationError("A reason is required when rejecting a post");
    }
};

// Someone other than the author taking a published story down owes the author a reason (they are told it).
const checkTakedownReason = (post, user, input) => {
    const takesDown = post.status === "published" && ["draft", "archived"].includes(input.to);
    if (takesDown && post.userId !== user.id && !input.reason) {
        throw new ValidationError("A reason is required when taking down someone else's story");
    }
};

// The status change itself, inside the caller's transaction: lock the row, check the rule, apply it conditionally on
// the status that was checked, and write the audit row. Returns { post (as it was), auditId }. Used by the
// status endpoint and by the moderation queue ("unpublish this story"), so both follow exactly the same rules.
export const moveStatus = async (transaction, id, user, input, context, now = new Date()) => {
    const post = await lockPostById(id, transaction);
    if (!post || !canViewPost(user, post)) {
        throw new NotFoundError("Post not found");
    }

    const verdict = evaluateTransition(user, post, input.to);
    if (!verdict.ok) {
        throw new AppError(verdict.status, verdict.code, verdict.message);
    }
    checkInputs(input, now);
    checkTakedownReason(post, user, input);

    const changes = changesFor({ post, to: input.to, user, publishAt: input.publishAt, reason: input.reason, now });
    if ((await transitionPost(id, post.status, changes, { transaction })) === 0) {
        throw new ConflictError("The post was changed by someone else. Reload and try again.");
    }

    const latest = await findLatestRevision(id, { transaction });
    const audit = await recordAudit(
        {
            actorId: user.id,
            action: "post.status_changed",
            entityType: "post",
            entityId: id,
            metadata: {
                from: post.status,
                to: input.to,
                ...(input.reason && { reason: input.reason }),
                ...(input.publishAt && { publishAt: input.publishAt.toISOString() }),
                revision: latest?.version ?? null,
            },
        },
        { context, transaction },
    );
    return { post, auditId: audit.id };
};

// Tell the people a status change concerns (after it committed): editors about a submission, an author about an
// approval, a rejection or a take-down by someone else.
export const announceStatusChange = ({ id, post, user, input, auditId, now }) => {
    if (["pending_review", "published", "rejected"].includes(input.to)) {
        void publishEvent({ event: "post_status_changed", postId: id, to: input.to, actorId: user.id, at: now.getTime() });
    }
    if (post.status === "published" && ["draft", "archived"].includes(input.to) && post.userId !== user.id) {
        void publishEvent({ event: "content_removed", kind: "post", postId: id, actorId: user.id, auditLogId: auditId, at: now.getTime() });
    }
};

// Move a post to another status. The post row is locked while the rule is checked and applied, and
// the write is conditional on the status that was checked, so two editors approving at once (or an
// author withdrawing as an editor approves) cannot both win. The audit row commits with the change.
export const changePostStatus = async (id, user, input, context) => {
    const now = new Date();

    const { post: before, auditId } = await withTransaction((transaction) => moveStatus(transaction, id, user, input, context, now));
    announceStatusChange({ id, post: before, user, input, auditId, now });

    const post = await findPostById(id);
    await attachPostData([post]);
    return toPostDto(post, user);
};
