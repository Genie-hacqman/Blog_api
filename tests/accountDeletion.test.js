import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, refreshCookieFrom, COOKIE_HEADERS } from "./helpers.js";
import { makeImage } from "./imageHelpers.js";
import { AuditLog, Media, Post, RefreshToken, User, UserToken } from "../database/models/index.js";
import { clearSentEmails, lastEmailTo, sentEmails } from "../providers/email/memory.js";
import { clearStoredFiles, storedFiles } from "../providers/storage/memory.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const deleteMe = (token, password) => request(app).delete("/api/users/me").set(bearer(token)).send({ password });

describe("account deletion", () => {
    before(resetDatabase);
    after(closeDatabase);
    beforeEach(() => {
        clearSentEmails();
        clearStoredFiles();
    });

    const writer = async (overrides = {}) => {
        const session = await registerAndLogin({ role: "editor", firstName: "Grace", lastName: "Hopper", ...overrides });
        await request(app).patch("/api/users/me").set(bearer(session.token)).send({ bio: "compilers", socialLinks: { github: "https://github.com/grace" } });
        await request(app).put("/api/users/me/avatar").set(bearer(session.token)).attach("file", await makeImage(), "me.jpg");
        const published = await request(app).post("/api/posts").set(bearer(session.token)).send({ title: "Kept", content: "Stays", status: "published" });
        const draft = await request(app).post("/api/posts").set(bearer(session.token)).send({ title: "Dropped", content: "Goes", status: "draft" });
        return { ...session, publishedId: published.body.data.post.id, draftId: draft.body.data.post.id };
    };

    it("rejects a wrong password with 400 and leaves everything in place", async () => {
        const grace = await writer();

        const response = await deleteMe(grace.token, "not my password");

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "INVALID_PASSWORD");
        assert.equal((await request(app).get("/api/auth/me").set(bearer(grace.token))).status, 200, "the session survives");
        assert.equal((await User.findByPk(grace.user.id)).status, "active");
    });

    it("requires a password and a login", async () => {
        const grace = await writer();

        assert.equal((await request(app).delete("/api/users/me").set(bearer(grace.token)).send({})).status, 400);
        assert.equal((await request(app).delete("/api/users/me").send({ password: "x" })).status, 401);
    });

    it("wipes every personal detail but keeps the row", async () => {
        const grace = await writer();
        const email = grace.credentials.email;

        const response = await deleteMe(grace.token, grace.credentials.password);

        assert.equal(response.status, 200);
        const row = await User.findByPk(grace.user.id);
        assert.equal(row.status, "deleted");
        assert.ok(row.deletedAt);
        assert.equal(row.email, `deleted-${grace.user.id}@deleted.invalid`);
        assert.equal(row.username, `deleted-${grace.user.id}`);
        assert.equal(row.firstName, "Deleted");
        assert.equal(row.lastName, "User");
        assert.equal(row.bio, null);
        assert.equal(row.socialLinks, null);
        assert.equal(row.avatarMediaId, null);
        assert.notEqual(row.password, grace.credentials.password);
        const everything = JSON.stringify(row.toJSON());
        for (const personal of [email, "Grace", "Hopper", "compilers", grace.credentials.userName]) {
            assert.ok(!everything.includes(personal), `${personal} must be gone from the user row`);
        }
    });

    it("ends every session and refuses logins", async () => {
        const grace = await writer();
        const second = await request(app).post("/api/auth/login").send({ email: grace.credentials.email, password: grace.credentials.password });
        const secondCookie = refreshCookieFrom(second);

        await deleteMe(grace.token, grace.credentials.password);

        assert.equal((await request(app).get("/api/auth/me").set(bearer(grace.token))).status, 401);
        assert.equal((await request(app).get("/api/auth/me").set(bearer(second.body.data.accessToken))).status, 401);
        assert.equal((await request(app).post("/api/auth/refresh").set(COOKIE_HEADERS).set("Cookie", secondCookie)).status, 401);
        const attempt = await request(app).post("/api/auth/login").send({ email: grace.credentials.email, password: grace.credentials.password });
        assert.equal(attempt.status, 401);
        assert.equal(await RefreshToken.count({ where: { userId: grace.user.id, revokedAt: null } }), 0);
    });

    it("deletes drafts, keeps published posts under a generic byline", async () => {
        const grace = await writer();
        const reader = await registerAndLogin();

        await deleteMe(grace.token, grace.credentials.password);

        assert.equal(await Post.findByPk(grace.draftId), null);
        const kept = await request(app).get(`/api/posts/${grace.publishedId}`).set(bearer(reader.token));
        assert.equal(kept.status, 200);
        assert.equal(kept.body.data.post.title, "Kept");
        assert.deepEqual({ ...kept.body.data.post.author, id: undefined }, { id: undefined, username: "Deleted user", avatarUrl: null, deleted: true });

        const list = await request(app).get("/api/posts");
        assert.ok(list.body.data.posts.some((post) => post.title === "Kept" && post.author.username === "Deleted user"));
        assert.ok(!JSON.stringify(list.body).includes(grace.credentials.userName));
    });

    it("deletes unpublished work in every state (review, scheduled, private, archived, rejected) and keeps only published posts", async () => {
        const grace = await writer();
        const states = ["pending_review", "scheduled", "private", "archived", "rejected"];
        for (const status of states) {
            await Post.create({
                title: `Was ${status}`, content: "Body.", userId: grace.user.id, status, slug: `was-${status}`, excerpt: "Body.", readingTime: 1,
                scheduledAt: status === "scheduled" ? new Date(Date.now() + 3600_000) : null,
            });
        }

        await deleteMe(grace.token, grace.credentials.password);

        const remaining = await Post.findAll({ where: { userId: grace.user.id } });
        assert.deepEqual(remaining.map((post) => post.id), [grace.publishedId]);
    });

    it("removes the public profile and the avatar file", async () => {
        const grace = await writer();
        assert.equal(storedFiles.size, 1);

        await deleteMe(grace.token, grace.credentials.password);

        assert.equal((await request(app).get(`/api/users/${grace.credentials.userName}`)).status, 404);
        assert.equal((await request(app).get(`/api/users/deleted-${grace.user.id}`)).status, 404);
        assert.equal(storedFiles.size, 0);
        assert.ok((await Media.findOne({ where: { ownerId: grace.user.id } })).deletedAt);
    });

    it("clears the refresh cookie and discards unused email tokens", async () => {
        const grace = await registerAndLogin({ verified: false });
        await request(app).post("/api/auth/forgot-password").send({ email: grace.credentials.email });
        assert.ok((await UserToken.count({ where: { userId: grace.user.id } })) > 0);

        const response = await deleteMe(grace.token, grace.credentials.password);

        assert.match(response.headers["set-cookie"].find((c) => c.startsWith("refresh_token=")), /Expires=Thu, 01 Jan 1970/);
        assert.equal(await UserToken.count({ where: { userId: grace.user.id } }), 0);
    });

    it("frees the email and username for a new registration", async () => {
        const grace = await writer();
        await deleteMe(grace.token, grace.credentials.password);

        const again = await request(app).post("/api/auth/register").send({ ...grace.credentials });

        assert.equal(again.status, 201);
        assert.notEqual(again.body.data.user.id, grace.user.id);
    });

    it("sends a confirmation to the original address and records an audit row without personal data", async () => {
        const grace = await writer();
        const email = grace.credentials.email;
        clearSentEmails();

        await deleteMe(grace.token, grace.credentials.password);

        const mail = lastEmailTo(email);
        assert.ok(mail, "a confirmation email should be sent to the address the account had");
        assert.match(mail.subject, /account was deleted/i);
        assert.ok(sentEmails.every((message) => message.to !== `deleted-${grace.user.id}@deleted.invalid`));

        const audit = await AuditLog.findOne({ where: { action: "user.deleted", entityId: String(grace.user.id) } });
        assert.equal(audit.actorId, grace.user.id);
        const serialized = JSON.stringify(audit.toJSON());
        for (const personal of [email, "Grace", "Hopper", grace.credentials.userName]) {
            assert.ok(!serialized.includes(personal), `${personal} must not be in the audit row`);
        }
    });
});
