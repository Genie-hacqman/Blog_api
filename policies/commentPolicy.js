import { roleHasPermission } from "../config/roles.js";

// Resource-level rules for comments. `post` is the post the comment is on (it needs userId).

// only the author edits a comment, and only while it exists
export const canEditComment = (user, comment) => Boolean(user) && !comment.deletedAt && comment.userId === user.id;

// who may remove a comment: its author, the author of the post it is on, and editors/admins
export const canDeleteComment = (user, comment, post) =>
    Boolean(user) &&
    !comment.deletedAt &&
    (comment.userId === user.id || post.userId === user.id || roleHasPermission(user.role, "comment:moderate"));

// which hat a deletion by someone other than the author was done in (for the audit trail)
export const deletionCapacity = (user, post) => (post.userId === user.id ? "post_author" : "moderator");
