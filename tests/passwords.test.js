import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, refreshCookieFrom, registerAndLogin, resetDatabase, closeDatabase, COOKIE_HEADERS } from "./helpers.js";
import { AuditLog, User, UserToken } from "../database/models/index.js";
import { clearSentEmails, lastEmailTo, sentEmails } from "../providers/email/memory.js";

// the emailed link ends in ?token=<value>
const tokenFrom = (message) => decodeURIComponent(message.text.match(/token=([^\s&]+)/)[1]);

const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });
const me = (token) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

// one pool for the whole file: close it once, after the last describe
after(closeDatabase);

describe("auth: email verification", () => {
    before(resetDatabase);

    it("verifies the email once with the emailed token, then sends a welcome email", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        const token = tokenFrom(lastEmailTo(session.credentials.email));

        const response = await request(app).post("/api/auth/verify-email").send({ token });

        assert.equal(response.status, 200);
        assert.equal((await me(session.token)).body.data.user.emailVerified, true);
        assert.match(lastEmailTo(session.credentials.email).subject, /welcome/i);

        const again = await request(app).post("/api/auth/verify-email").send({ token });
        assert.equal(again.status, 400);
        assert.equal(again.body.error.code, "INVALID_TOKEN");
    });

    it("rejects garbage and expired tokens with the same generic error", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        const token = tokenFrom(lastEmailTo(session.credentials.email));
        await UserToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: session.user.id } });

        const expired = await request(app).post("/api/auth/verify-email").send({ token });
        const garbage = await request(app).post("/api/auth/verify-email").send({ token: "nope" });

        assert.equal(expired.status, 400);
        assert.deepEqual(expired.body, garbage.body);
    });

    it("stores only a hash of the token", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        const token = tokenFrom(lastEmailTo(session.credentials.email));

        const rows = await UserToken.findAll({ where: { userId: session.user.id } });

        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => row.tokenHash !== token && row.tokenHash.length === 64));
    });

    it("resend replaces the old link; a verified user gets nothing", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        const oldToken = tokenFrom(lastEmailTo(session.credentials.email));
        clearSentEmails();

        const resend = await request(app).post("/api/auth/resend-verification").set("Authorization", `Bearer ${session.token}`);
        assert.equal(resend.status, 200);
        const newToken = tokenFrom(lastEmailTo(session.credentials.email));

        assert.notEqual(newToken, oldToken);
        assert.equal((await request(app).post("/api/auth/verify-email").send({ token: oldToken })).status, 400);
        assert.equal((await request(app).post("/api/auth/verify-email").send({ token: newToken })).status, 200);

        clearSentEmails();
        await request(app).post("/api/auth/resend-verification").set("Authorization", `Bearer ${session.token}`);
        assert.equal(sentEmails.length, 0);
    });

    it("escapes user-supplied names in the HTML of emails", async () => {
        await request(app)
            .post("/api/auth/register")
            .send({ firstName: "<script>alert(1)</script>", lastName: "X", userName: "xss", email: "xss@example.com", password: "password123" });

        const mail = lastEmailTo("xss@example.com");

        assert.ok(!mail.html.includes("<script>"));
        assert.ok(mail.html.includes("&lt;script&gt;"));
    });
});

describe("auth: forgot and reset password", () => {
    before(resetDatabase);

    it("answers identically for known and unknown emails, and only emails known ones", async () => {
        const session = await registerAndLogin();
        clearSentEmails();

        const known = await request(app).post("/api/auth/forgot-password").send({ email: session.credentials.email });
        const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "ghost@example.com" });

        assert.equal(known.status, 200);
        assert.deepEqual(known.body, unknown.body);
        assert.equal(sentEmails.length, 1);
        assert.equal(sentEmails[0].to, session.credentials.email);
    });

    it("sends at most three reset emails per account per hour", async () => {
        const session = await registerAndLogin();
        clearSentEmails();

        for (let i = 0; i < 5; i += 1) {
            await request(app).post("/api/auth/forgot-password").send({ email: session.credentials.email });
        }

        assert.equal(sentEmails.length, 3);
    });

    it("resets the password once, signs out every session and clears a lockout", async () => {
        const session = await registerAndLogin();
        await User.update({ failedLoginCount: 4, lockedUntil: new Date(Date.now() + 600_000) }, { where: { id: session.user.id } });
        await request(app).post("/api/auth/forgot-password").send({ email: session.credentials.email });
        const token = tokenFrom(lastEmailTo(session.credentials.email));
        clearSentEmails();

        const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "a brand new password" });

        assert.equal(reset.status, 200);
        assert.equal((await me(session.token)).status, 401, "old sessions must end");
        assert.equal((await login(session.credentials.email, session.credentials.password)).status, 401);
        assert.equal((await login(session.credentials.email, "a brand new password")).status, 200);
        assert.match(lastEmailTo(session.credentials.email).subject, /password was changed/i);

        const user = await User.findByPk(session.user.id);
        assert.equal(user.failedLoginCount, 0);

        const reused = await request(app).post("/api/auth/reset-password").send({ token, password: "yet another password" });
        assert.equal(reused.status, 400);
        assert.equal(reused.body.error.code, "INVALID_TOKEN");
    });

    it("rejects expired tokens, weak passwords and verification tokens used as reset tokens", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        const verifyToken = tokenFrom(lastEmailTo(session.credentials.email));
        await request(app).post("/api/auth/forgot-password").send({ email: session.credentials.email });
        const resetToken = tokenFrom(lastEmailTo(session.credentials.email));

        assert.equal((await request(app).post("/api/auth/reset-password").send({ token: verifyToken, password: "long enough pw" })).status, 400);
        assert.equal((await request(app).post("/api/auth/reset-password").send({ token: resetToken, password: "short" })).status, 400);

        await UserToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: session.user.id, purpose: "reset_password" } });
        assert.equal((await request(app).post("/api/auth/reset-password").send({ token: resetToken, password: "long enough pw" })).status, 400);
    });

    it("a reset proves mailbox ownership, so it verifies the email", async () => {
        const session = await registerAndLogin({ role: "user", verified: false });
        await request(app).post("/api/auth/forgot-password").send({ email: session.credentials.email });
        const token = tokenFrom(lastEmailTo(session.credentials.email));

        await request(app).post("/api/auth/reset-password").send({ token, password: "long enough pw" });

        assert.ok((await User.findByPk(session.user.id)).emailVerifiedAt);
    });
});

describe("auth: change password", () => {
    before(resetDatabase);

    it("rejects a wrong current password with 400 (not 401, which would look like an expired session)", async () => {
        const session = await registerAndLogin();

        const response = await request(app)
            .post("/api/auth/change-password")
            .set("Authorization", `Bearer ${session.token}`)
            .send({ currentPassword: "not my password", newPassword: "brand new password" });

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "INVALID_PASSWORD");
        assert.equal((await me(session.token)).status, 200);
    });

    it("rejects reusing the current password", async () => {
        const session = await registerAndLogin();

        const response = await request(app)
            .post("/api/auth/change-password")
            .set("Authorization", `Bearer ${session.token}`)
            .send({ currentPassword: session.credentials.password, newPassword: session.credentials.password });

        assert.equal(response.status, 400);
    });

    it("signs out other devices but keeps this one, and emails a notice", async () => {
        const session = await registerAndLogin();
        const otherDevice = await login(session.credentials.email, session.credentials.password);
        const otherToken = otherDevice.body.data.accessToken;
        const otherCookie = refreshCookieFrom(otherDevice);
        clearSentEmails();

        const response = await request(app)
            .post("/api/auth/change-password")
            .set("Authorization", `Bearer ${session.token}`)
            .send({ currentPassword: session.credentials.password, newPassword: "brand new password" });

        assert.equal(response.status, 200);
        assert.equal((await me(session.token)).status, 200, "this session survives");
        assert.equal((await me(otherToken)).status, 401, "other sessions end");
        assert.equal((await request(app).post("/api/auth/refresh").set(COOKIE_HEADERS).set("Cookie", otherCookie)).status, 401);
        assert.equal((await login(session.credentials.email, "brand new password")).status, 200);
        assert.equal((await login(session.credentials.email, session.credentials.password)).status, 401);
        assert.match(lastEmailTo(session.credentials.email).subject, /password was changed/i);
    });

    it("requires authentication", async () => {
        const response = await request(app).post("/api/auth/change-password").send({ currentPassword: "x", newPassword: "long enough pw" });

        assert.equal(response.status, 401);
    });

    it("audits password changes and resets without recording any secret", async () => {
        const rows = await AuditLog.findAll({ where: { action: "auth.password_changed" } });

        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => row.metadata === null || !/pass|token|secret/i.test(JSON.stringify(Object.keys(row.metadata)))));
    });
});
