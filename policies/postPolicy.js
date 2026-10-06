import { roleHasPermission } from "../config/roles.js";

// Resource-level rules for posts. Coarse "may this role do this at all" checks are
// requirePermission() on the route; these answer "may this user do it to this post".
// `user` is null for an anonymous visitor.

const isOwner = (user, post) => Boolean(user) && post.userId === user.id;

// statuses an editor may look at (they review and moderate, but never see someone else's drafts or private notes)
const REVIEWER_VISIBLE = new Set(["pending_review", "rejected", "scheduled", "archived"]);

// Published posts are public. Everything else belongs to its author, apart from the review
// and moderation states, which editors and admins can also see.
export const canViewPost = (user, post) => {
    if (post.status === "published") return true;
    if (!user) return false;
    if (isOwner(user, post)) return true;
    return REVIEWER_VISIBLE.has(post.status) && roleHasPermission(user.role, "post:review");
};

// content can be edited by its author in these states. A post waiting for review, scheduled or
// archived is "locked": the author must withdraw or unarchive it first, so what an editor
// approved is what gets published.
export const EDITABLE_STATUSES = new Set(["draft", "rejected", "private", "published"]);

export const canModifyPost = (user, post) => isOwner(user, post) && roleHasPermission(user.role, "post:update_own");

export const canDeletePost = (user, post) => isOwner(user, post) && roleHasPermission(user.role, "post:delete_own");

// history is for the author and for editors who can see the post
export const canViewRevisions = (user, post) =>
    canViewPost(user, post) && Boolean(user) && (isOwner(user, post) || roleHasPermission(user.role, "post:review"));
