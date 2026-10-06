import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, User } from "../database/models/index.js";
import { env } from "../config/env.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const createPost = (token, body = { title: "A title", content: "Some content" }) =>
    request(app).post("/api/posts").set(bearer(token)).send(body);
const setRole = (token, id, role) => request(app).patch(`/api/admin/users/${id}/role`).set(bearer(token)).send({ role });

// one pool for the whole file: close it once, after the last describe
after(closeDatabase);

describe("authorization: roles and posts", () => {
    before(resetDatabase);

    it("a plain 'user' cannot create posts (403 FORBIDDEN); an author can", async () => {
        const reader = await registerAndLogin({ role: "user" });
        const author = await registerAndLogin({ role: "author" });

        const denied = await createPost(reader.token);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error.code, "FORBIDDEN");
        assert.equal((await createPost(author.token)).status, 201);
    });

    it("an unverified author cannot create posts until the flag is turned off", async () => {
        const author = await registerAndLogin({ role: "author", verified: false });

        const denied = await createPost(author.token);
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error.code, "EMAIL_NOT_VERIFIED");

        env.REQUIRE_VERIFIED_EMAIL = false;
        try {
            assert.equal((await createPost(author.token)).status, 201);
        } finally {
            env.REQUIRE_VERIFIED_EMAIL = true;
        }
    });

    it("become-author upgrades a verified user, is audited, and is idempotent", async () => {
        const reader = await registerAndLogin({ role: "user" });

        const first = await request(app).post("/api/users/me/become-author").set(bearer(reader.token));
        assert.equal(first.status, 200);
        assert.equal(first.body.data.user.role, "author");
        assert.equal((await createPost(reader.token)).status, 201);

        const again = await request(app).post("/api/users/me/become-author").set(bearer(reader.token));
        assert.equal(again.status, 200);

        const audit = await AuditLog.findAll({ where: { action: "user.became_author", entityId: String(reader.user.id) } });
        assert.equal(audit.length, 1);
    });

    it("become-author needs a verified email", async () => {
        const reader = await registerAndLogin({ role: "user", verified: false });

        const response = await request(app).post("/api/users/me/become-author").set(bearer(reader.token));

        assert.equal(response.status, 403);
        assert.equal(response.body.error.code, "EMAIL_NOT_VERIFIED");
        assert.equal((await User.findByPk(reader.user.id)).role, "user");
    });

    it("roles are read from the database on every request: a demoted author loses write access immediately", async () => {
        const author = await registerAndLogin({ role: "author" });
        const created = await createPost(author.token);
        const postId = created.body.data.post.id;

        await User.update({ role: "user" }, { where: { id: author.user.id } });

        const edit = await request(app).patch(`/api/posts/${postId}`).set(bearer(author.token)).send({ title: "Edited" });
        assert.equal(edit.status, 403);
        assert.equal((await createPost(author.token)).status, 403);
        // reading is still fine
        assert.equal((await request(app).get(`/api/posts/${postId}`).set(bearer(author.token))).status, 200);
    });

    it("hides another user's draft from PATCH and DELETE with 404, like a missing post", async () => {
        const owner = await registerAndLogin();
        const stranger = await registerAndLogin();
        const draft = await createPost(owner.token, { title: "Secret", content: "Not yet", status: "draft" });
        const id = draft.body.data.post.id;

        const patch = await request(app).patch(`/api/posts/${id}`).set(bearer(stranger.token)).send({ title: "Mine now" });
        const del = await request(app).delete(`/api/posts/${id}`).set(bearer(stranger.token));
        const missing = await request(app).delete("/api/posts/999999").set(bearer(stranger.token));

        assert.equal(patch.status, 404);
        assert.equal(del.status, 404);
        assert.deepEqual(del.body, missing.body, "a private draft must be indistinguishable from a missing post");
        assert.equal((await request(app).get(`/api/posts/${id}`).set(bearer(owner.token))).body.data.post.title, "Secret");
    });

    it("still answers 403 when a visible (published) post belongs to someone else", async () => {
        const owner = await registerAndLogin({ role: "editor" });
        const stranger = await registerAndLogin();
        const post = await createPost(owner.token, { title: "Out in the open", content: "Published", status: "published" });

        const patch = await request(app).patch(`/api/posts/${post.body.data.post.id}`).set(bearer(stranger.token)).send({ title: "x" });

        assert.equal(patch.status, 403);
    });
});

describe("authorization: admin", () => {
    let admin;
    let author;

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        author = await registerAndLogin({ role: "author" });
    });

    it("rejects anonymous, non-admin and unverified callers of admin endpoints", async () => {
        assert.equal((await request(app).get("/api/admin/audit-logs")).status, 401);
        assert.equal((await request(app).get("/api/admin/audit-logs").set(bearer(author.token))).status, 403);
        assert.equal((await setRole(author.token, author.user.id, "admin")).status, 403, "no self-promotion");
        assert.equal((await User.findByPk(author.user.id)).role, "author");
    });

    it("an admin can change a role, which takes effect without a new login, and it is audited with from/to", async () => {
        const response = await setRole(admin.token, author.user.id, "editor");

        assert.equal(response.status, 200);
        assert.equal(response.body.data.user.role, "editor");
        assert.equal((await request(app).get("/api/auth/me").set(bearer(author.token))).body.data.user.role, "editor");

        const audit = await AuditLog.findOne({ where: { action: "user.role_changed", entityId: String(author.user.id) } });
        assert.equal(audit.actorId, admin.user.id);
        assert.deepEqual(audit.metadata, { from: "author", to: "editor" });
    });

    it("validates the role, the user id and the target", async () => {
        assert.equal((await setRole(admin.token, author.user.id, "superuser")).status, 400);
        assert.equal((await setRole(admin.token, "abc", "author")).status, 404);
        assert.equal((await setRole(admin.token, 999999, "author")).status, 404);
    });

    it("an admin cannot change their own role", async () => {
        const response = await setRole(admin.token, admin.user.id, "user");

        assert.equal(response.status, 403);
        assert.equal((await User.findByPk(admin.user.id)).role, "admin");
    });

    it("two admins demoting each other at the same moment cannot leave the system without an admin", async () => {
        const first = await registerAndLogin({ role: "admin" });
        const second = await registerAndLogin({ role: "admin" });

        await Promise.all([setRole(first.token, second.user.id, "user"), setRole(second.token, first.user.id, "user")]);

        const admins = await User.count({ where: { role: "admin", id: [first.user.id, second.user.id] } });
        assert.equal(admins, 1);
    });

    it("lists audit logs for admins, newest first, with filters and pagination", async () => {
        const all = await request(app).get("/api/admin/audit-logs").set(bearer(admin.token));

        assert.equal(all.status, 200);
        assert.ok(all.body.data.logs.length > 0);
        assert.ok(all.body.meta.pagination.total >= all.body.data.logs.length);
        const times = all.body.data.logs.map((log) => new Date(log.createdAt).getTime());
        assert.deepEqual(times, [...times].sort((a, b) => b - a));

        const filtered = await request(app).get(`/api/admin/audit-logs?action=user.role_changed&actorId=${admin.user.id}&limit=1`).set(bearer(admin.token));
        assert.equal(filtered.body.data.logs.length, 1);
        assert.equal(filtered.body.data.logs[0].action, "user.role_changed");
        assert.equal(filtered.body.data.logs[0].actor.id, admin.user.id);
    });

    it("never stores credential-shaped data in audit metadata", async () => {
        const rows = await AuditLog.findAll();

        for (const row of rows) {
            const serialized = JSON.stringify(row.metadata ?? {});
            assert.ok(!/pass|token|secret|hash|cookie/i.test(serialized), `audit row ${row.action} leaked: ${serialized}`);
        }
    });
});
