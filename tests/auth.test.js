import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, User } from "../database/models/index.js";
import { lastEmailTo } from "../providers/email/memory.js";
import { MAX_FAILED_LOGINS } from "../config/auth.js";

const validUser = {
    firstName: "Ada",
    lastName: "Lovelace",
    userName: "ada",
    email: "ada@example.com",
    password: "password123",
};

const login = (email, password) => request(app).post("/api/auth/login").send({ email, password });

describe("auth: registration and login", () => {
    before(resetDatabase);
    after(closeDatabase);

    it("registers an unverified 'user', never returns the password, and emails a verification link", async () => {
        const response = await request(app).post("/api/auth/register").send(validUser);

        assert.equal(response.status, 201);
        assert.equal(response.body.data.user.email, validUser.email);
        assert.equal(response.body.data.user.role, "user");
        assert.equal(response.body.data.user.emailVerified, false);
        assert.equal(response.body.data.user.password, undefined);
        assert.ok(!JSON.stringify(response.body).includes(validUser.password));

        const mail = lastEmailTo(validUser.email);
        assert.ok(mail, "a verification email should have been sent");
        assert.match(mail.text, /\/verify-email\?token=/);
    });

    it("stores an argon2id hash, not the password", async () => {
        const user = await User.findOne({ where: { email: validUser.email } });

        assert.match(user.password, /^\$argon2id\$/);
    });

    it("no longer serves the old /api/users/register and /login URLs", async () => {
        const registered = await request(app).post("/api/users/register").send({ ...validUser, userName: "alias", email: "alias@example.com" });
        const loggedIn = await request(app).post("/api/users/login").send({ email: validUser.email, password: validUser.password });

        // /api/users/:username is a public profile route, and these are not profiles
        assert.equal(registered.status, 404);
        assert.equal(loggedIn.status, 404);
    });

    it("rejects a duplicate email with 409", async () => {
        const response = await request(app).post("/api/auth/register").send({ ...validUser, userName: "different" });

        assert.equal(response.status, 409);
        assert.equal(response.body.error.message, "Email is already taken");
    });

    it("treats emails case-insensitively", async () => {
        const response = await request(app)
            .post("/api/auth/register")
            .send({ ...validUser, userName: "shout", email: "ADA@EXAMPLE.COM" });

        assert.equal(response.status, 409);
    });

    it("rejects a duplicate username with 409", async () => {
        const response = await request(app).post("/api/auth/register").send({ ...validUser, email: "different@example.com" });

        assert.equal(response.status, 409);
        assert.equal(response.body.error.message, "Username is already taken");
    });

    it("rejects missing fields, short and over-long passwords with 400", async () => {
        const empty = await request(app).post("/api/auth/register").send({});
        const short = await request(app).post("/api/auth/register").send({ ...validUser, userName: "s", email: "s@example.com", password: "short" });
        const long = await request(app).post("/api/auth/register").send({ ...validUser, userName: "l", email: "l@example.com", password: "x".repeat(129) });

        assert.deepEqual([empty.status, short.status, long.status], [400, 400, 400]);
    });

    it("logs in, returns an access token in the body and the refresh token only in an HttpOnly cookie", async () => {
        const response = await login(validUser.email, validUser.password);

        assert.equal(response.status, 200);
        assert.ok(response.body.data.accessToken);
        assert.equal(response.body.data.user.password, undefined);

        const cookie = response.headers["set-cookie"].find((c) => c.startsWith("refresh_token="));
        assert.ok(cookie, "refresh cookie should be set");
        assert.match(cookie, /HttpOnly/i);
        assert.match(cookie, /Path=\/api\/auth/i);
        assert.match(cookie, /SameSite=Lax/i);

        const refreshValue = cookie.split(";")[0].split("=")[1];
        assert.ok(!JSON.stringify(response.body).includes(refreshValue), "refresh token must never appear in the body");
    });

    it("logs in with a differently-cased email", async () => {
        const response = await login("ADA@Example.com", validUser.password);

        assert.equal(response.status, 200);
    });

    it("answers a wrong password and an unknown email identically with 401", async () => {
        const wrong = await login(validUser.email, "wrongpassword");
        const unknown = await login("nobody@example.com", "password123");

        assert.equal(wrong.status, 401);
        assert.equal(unknown.status, 401);
        assert.deepEqual(wrong.body, unknown.body);
        assert.equal(wrong.body.error.message, "Invalid email or password");
    });

    it("answers a wrong password that is shorter than 8 characters with 401, not 400", async () => {
        const response = await login(validUser.email, "abc");

        assert.equal(response.status, 401);
    });

    it("does not trim passwords: one with surrounding spaces registers and logs in", async () => {
        const spaced = { ...validUser, userName: "spaced", email: "spaced@example.com", password: "  padded pass  " };
        await request(app).post("/api/auth/register").send(spaced);

        assert.equal((await login(spaced.email, "  padded pass  ")).status, 200);
        assert.equal((await login(spaced.email, "padded pass")).status, 401);
    });

    it("upgrades a legacy bcrypt hash to argon2id on the next login", async () => {
        await User.create({
            firstName: "Old",
            lastName: "Timer",
            username: "oldtimer",
            email: "oldtimer@example.com",
            password: await bcrypt.hash("legacy-password", 10),
        });

        const response = await login("oldtimer@example.com", "legacy-password");
        assert.equal(response.status, 200);

        const user = await User.findOne({ where: { email: "oldtimer@example.com" } });
        assert.match(user.password, /^\$argon2id\$/);
        assert.equal((await login("oldtimer@example.com", "legacy-password")).status, 200);
    });

    it("locks an account after repeated failures, even for the right password, then lets it back in", async () => {
        const target = { ...validUser, userName: "victim", email: "victim@example.com" };
        await request(app).post("/api/auth/register").send(target);

        for (let attempt = 0; attempt < MAX_FAILED_LOGINS; attempt += 1) {
            assert.equal((await login(target.email, "wrong-password")).status, 401);
        }

        const locked = await login(target.email, target.password);
        assert.equal(locked.status, 429);
        assert.equal(locked.body.error.code, "RATE_LIMITED");

        const audit = await AuditLog.findOne({ where: { action: "auth.account_locked" } });
        assert.ok(audit);

        await User.update({ lockedUntil: new Date(Date.now() - 1000) }, { where: { email: target.email } });
        assert.equal((await login(target.email, target.password)).status, 200);
        assert.equal((await User.findOne({ where: { email: target.email } })).failedLoginCount, 0);
    });

    it("refuses a suspended account at login and ends its existing sessions", async () => {
        const { token, credentials } = await registerAndLogin();
        assert.equal((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status, 200);

        await User.update({ status: "suspended" }, { where: { email: credentials.email } });

        const afterSuspension = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
        assert.equal(afterSuspension.status, 401);

        const attempt = await login(credentials.email, credentials.password);
        assert.equal(attempt.status, 403);
        assert.equal(attempt.body.error.code, "ACCOUNT_SUSPENDED");
    });

    it("treats a deleted account like one that never existed", async () => {
        const { credentials } = await registerAndLogin();
        await User.update({ status: "deleted" }, { where: { email: credentials.email } });

        const attempt = await login(credentials.email, credentials.password);

        assert.equal(attempt.status, 401);
        assert.equal(attempt.body.error.message, "Invalid email or password");
    });

    it("GET /api/auth/me returns the current user with role and verification state", async () => {
        const { token } = await registerAndLogin({ role: "editor" });

        const response = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.user.role, "editor");
        assert.equal(response.body.data.user.emailVerified, true);
    });

    it("records successful logins in the audit log without secrets", async () => {
        const rows = await AuditLog.findAll({ where: { action: "auth.login" } });

        assert.ok(rows.length > 0);
        assert.ok(rows.every((row) => !JSON.stringify(row.metadata ?? {}).match(/pass|token|secret/i)));
    });
});
