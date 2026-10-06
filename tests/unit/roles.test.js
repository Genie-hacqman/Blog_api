import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasRoleAtLeast, PERMISSIONS, roleHasPermission } from "../../config/roles.js";
import { canDeletePost, canModifyPost, canViewPost } from "../../policies/postPolicy.js";

describe("roles and permissions", () => {
    it("orders roles user < author < editor < admin", () => {
        assert.equal(hasRoleAtLeast("admin", "editor"), true);
        assert.equal(hasRoleAtLeast("editor", "author"), true);
        assert.equal(hasRoleAtLeast("author", "editor"), false);
        assert.equal(hasRoleAtLeast("user", "author"), false);
    });

    it("grants a permission to its minimum role and everything above", () => {
        assert.equal(roleHasPermission("user", "post:create"), false);
        assert.equal(roleHasPermission("author", "post:create"), true);
        assert.equal(roleHasPermission("admin", "post:create"), true);
        assert.equal(roleHasPermission("editor", "user:set_role"), false);
        assert.equal(roleHasPermission("admin", "user:set_role"), true);
    });

    it("denies unknown permissions and unknown roles", () => {
        assert.equal(roleHasPermission("admin", "world:domination"), false);
        assert.equal(roleHasPermission("superuser", "post:create"), false);
        assert.equal(roleHasPermission(undefined, "post:create"), false);
    });

    it("lists the permissions in use", () => {
        assert.ok(PERMISSIONS.includes("audit:read"));
    });
});

describe("postPolicy", () => {
    const author = { id: 1, role: "author" };
    const other = { id: 2, role: "author" };
    const demoted = { id: 1, role: "user" };
    const draft = { userId: 1, status: "draft" };
    const published = { userId: 1, status: "published" };

    it("shows published posts to everyone but drafts only to their author", () => {
        assert.equal(canViewPost(other, published), true);
        assert.equal(canViewPost(other, draft), false);
        assert.equal(canViewPost(author, draft), true);
    });

    it("lets only the owner, and only with the author permission, modify or delete", () => {
        assert.equal(canModifyPost(author, published), true);
        assert.equal(canModifyPost(other, published), false);
        assert.equal(canModifyPost(demoted, published), false);
        assert.equal(canDeletePost(author, draft), true);
        assert.equal(canDeletePost(other, draft), false);
    });
});
