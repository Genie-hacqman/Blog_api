import { roleHasPermission } from "../config/roles.js";
import { env } from "../config/env.js";
import { POST_STATUSES } from "../config/posts.js";
import { canViewPost } from "./postPolicy.js";

// The post lifecycle as data: TRANSITIONS[from][to] is the rule for who may make that move.
//
//   draft ──submit──▶ pending_review ──approve──▶ published ──archive──▶ archived
//     │                   │    └──reject──▶ rejected ──resubmit──▶ pending_review
//     └─(publishers)─────▶ published / scheduled ──(due time)──▶ published
//
// Authors submit; editors and admins review. Publishing without review needs `post:publish`
// (editors and up), or being the author while REQUIRE_POST_REVIEW is off.

const owns = (user, post) => post.userId === user.id && roleHasPermission(user.role, "post:update_own");
const canPublishDirectly = (user, post) =>
    roleHasPermission(user.role, "post:publish") || (owns(user, post) && !env.REQUIRE_POST_REVIEW);
// an editor never reviews their own work: that would defeat the second pair of eyes
const canReview = (user, post) => roleHasPermission(user.role, "post:review") && post.userId !== user.id;
const canModerate = (user) => roleHasPermission(user.role, "post:moderate");

const owner = (user, post) => owns(user, post);
const publisher = (user, post) => canPublishDirectly(user, post);
const reviewer = (user, post) => canReview(user, post);
const ownerOrModerator = (user, post) => owns(user, post) || canModerate(user);

export const TRANSITIONS = {
    draft: { pending_review: owner, published: publisher, scheduled: publisher, private: owner },
    pending_review: { draft: owner, published: reviewer, scheduled: reviewer, rejected: reviewer },
    rejected: { pending_review: owner, draft: owner, published: publisher, scheduled: publisher },
    scheduled: { draft: ownerOrModerator, published: publisher, scheduled: publisher },
    published: { draft: ownerOrModerator, archived: ownerOrModerator, private: owner },
    archived: { draft: owner, published: publisher, private: owner },
    private: { draft: owner, pending_review: owner, published: publisher, scheduled: publisher },
};

// moves that put a post in front of readers (now or later) without a reviewer's approval
const GOES_LIVE = new Set(["published", "scheduled"]);

// Decide whether `user` may move `post` to status `to`. A post the user cannot see at all is
// "not found" before anything else, so the table below never grants a move on someone's private draft.
export const evaluateTransition = (user, post, to) => {
    if (!canViewPost(user, post)) {
        return { ok: false, status: 404, code: "NOT_FOUND", message: "Post not found" };
    }
    if (!POST_STATUSES.includes(to)) {
        return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `Unknown status "${to}"` };
    }
    const rule = TRANSITIONS[post.status]?.[to];
    if (!rule) {
        return {
            ok: false,
            status: 409,
            code: "INVALID_TRANSITION",
            message: `A post that is ${post.status.replace("_", " ")} cannot be moved to ${to.replace("_", " ")}`,
        };
    }
    if (!rule(user, post)) {
        // the one denial worth explaining: authors asking to publish without review
        if (GOES_LIVE.has(to) && post.status !== "pending_review" && owns(user, post)) {
            return { ok: false, status: 403, code: "REVIEW_REQUIRED", message: "This post has to be reviewed by an editor before it is published" };
        }
        return { ok: false, status: 403, code: "FORBIDDEN", message: "You do not have permission to do that" };
    }
    return { ok: true };
};

// which statuses a user could move this post to right now (lets the UI show only valid buttons)
export const availableTransitions = (user, post) =>
    Object.keys(TRANSITIONS[post.status] ?? {}).filter((to) => evaluateTransition(user, post, to).ok);

export { canPublishDirectly };
