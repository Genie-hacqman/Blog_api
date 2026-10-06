import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import { app, request, refreshCookieFrom, registerAndLogin, resetDatabase, closeDatabase, COOKIE_HEADERS } from "./helpers.js";
import { AuditLog, RefreshToken } from "../database/models/index.js";
import { env } from "../config/env.js";

const refresh = (cookie, headers = COOKIE_HEADERS) => {
    const req = request(app).post("/api/auth/refresh").set(headers);
    return cookie ? req.set("Cookie", cookie) : req;
};
const me = (token) => request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

describe("auth: sessions", () => {
    before(resetDatabase);
    after(closeDatabase);

    it("refresh rotates the cookie and issues a working access token", async () => {
        const session = await registerAndLogin();

        const response = await refresh(session.cookie);

        assert.equal(response.status, 200);
        const rotated = refreshCookieFrom(response);
        assert.ok(rotated);
        assert.notEqual(rotated, session.cookie);
        assert.equal((await me(response.body.data.accessToken)).status, 200);
        assert.equal(response.body.data.user.email, session.credentials.email);
    });

    it("a rotated token presented again right away (two tabs) gets an access token but no new cookie", async () => {
        const session = await registerAndLogin();
        await refresh(session.cookie);

        const second = await refresh(session.cookie);

        assert.equal(second.status, 200);
        assert.equal(refreshCookieFrom(second), null);
        assert.equal((await me(second.body.data.accessToken)).status, 200);
    });

    it("a rotated token replayed after the grace window ends the whole session and is audited", async () => {
        const session = await registerAndLogin();
        const first = await refresh(session.cookie);
        const current = refreshCookieFrom(first);

        // age the rotation beyond the grace window
        await RefreshToken.update(
            { revokedAt: new Date(Date.now() - 60_000) },
            { where: { userId: session.user.id, replacedById: { [Op.ne]: null } } },
        );

        const replay = await refresh(session.cookie);
        assert.equal(replay.status, 401);

        // the replay also killed the legitimate, newer token and the access token bound to the session
        assert.equal((await refresh(current)).status, 401);
        assert.equal((await me(first.body.data.accessToken)).status, 401);

        const audit = await AuditLog.findOne({
            where: { action: "auth.refresh_reuse_detected", entityId: String(session.user.id) },
        });
        assert.ok(audit);
    });

    it("refuses refresh without a cookie, without the CSRF header, and from a foreign origin", async () => {
        const session = await registerAndLogin();

        assert.equal((await refresh(null)).status, 401);
        assert.equal((await refresh(session.cookie, {})).status, 403);
        assert.equal((await refresh(session.cookie, { ...COOKIE_HEADERS, Origin: "https://evil.example" })).status, 403);
        assert.equal((await refresh("refresh_token=not-a-real-token")).status, 401);
    });

    it("refuses an expired refresh token", async () => {
        const session = await registerAndLogin();
        await RefreshToken.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: session.user.id } });

        assert.equal((await refresh(session.cookie)).status, 401);
    });

    it("logout ends the session at once: the access token and the cookie both stop working", async () => {
        const session = await registerAndLogin();
        assert.equal((await me(session.token)).status, 200);

        const logout = await request(app).post("/api/auth/logout").set(COOKIE_HEADERS).set("Cookie", session.cookie);

        assert.equal(logout.status, 200);
        assert.match(logout.headers["set-cookie"].find((c) => c.startsWith("refresh_token=")), /Expires=Thu, 01 Jan 1970/);

        const afterLogout = await me(session.token);
        assert.equal(afterLogout.status, 401);
        assert.equal(afterLogout.body.error.message, "Session has ended");
        assert.equal((await refresh(session.cookie)).status, 401);
    });

    it("logging out twice, or with no cookie, is harmless", async () => {
        const session = await registerAndLogin();
        const logout = () => request(app).post("/api/auth/logout").set(COOKIE_HEADERS).set("Cookie", session.cookie);

        assert.equal((await logout()).status, 200);
        assert.equal((await logout()).status, 200);
        assert.equal((await request(app).post("/api/auth/logout").set(COOKIE_HEADERS)).status, 200);
    });

    it("logout requires the CSRF header", async () => {
        const session = await registerAndLogin();

        const response = await request(app).post("/api/auth/logout").set("Cookie", session.cookie);

        assert.equal(response.status, 403);
        assert.equal((await me(session.token)).status, 200);
    });

    it("logout-all ends every session of the user", async () => {
        const first = await registerAndLogin();
        const secondLogin = await request(app)
            .post("/api/auth/login")
            .send({ email: first.credentials.email, password: first.credentials.password });
        const secondToken = secondLogin.body.data.accessToken;
        const secondCookie = refreshCookieFrom(secondLogin);

        const response = await request(app).post("/api/auth/logout-all").set("Authorization", `Bearer ${first.token}`);

        assert.equal(response.status, 200);
        assert.equal((await me(first.token)).status, 401);
        assert.equal((await me(secondToken)).status, 401);
        assert.equal((await refresh(secondCookie)).status, 401);
    });

    it("rejects access tokens that are expired, for another audience, unsigned, or signed with another key", async () => {
        const session = await registerAndLogin();
        const base = { subject: String(session.user.id), issuer: "blog-api", audience: "blog-web" };
        const sid = (await RefreshToken.findOne({ where: { userId: session.user.id } })).familyId;

        const good = jwt.sign({ sid }, env.JWT_SECRET, { ...base, expiresIn: 60 });
        assert.equal((await me(good)).status, 200);

        const forged = {
            expired: jwt.sign({ sid }, env.JWT_SECRET, { ...base, expiresIn: -10 }),
            wrongAudience: jwt.sign({ sid }, env.JWT_SECRET, { ...base, audience: "someone-else", expiresIn: 60 }),
            wrongIssuer: jwt.sign({ sid }, env.JWT_SECRET, { ...base, issuer: "someone-else", expiresIn: 60 }),
            wrongKey: jwt.sign({ sid }, "another-secret-entirely", { ...base, expiresIn: 60 }),
            unsigned: jwt.sign({ sid }, "", { ...base, algorithm: "none", expiresIn: 60 }),
            legacyShape: jwt.sign({ id: session.user.id }, env.JWT_SECRET, { expiresIn: 60 }),
        };
        for (const [name, token] of Object.entries(forged)) {
            assert.equal((await me(token)).status, 401, `${name} token must be rejected`);
        }
    });

    it("rejects a valid-looking access token for a session that does not exist", async () => {
        const session = await registerAndLogin();
        const token = jwt.sign({ sid: "00000000-0000-4000-8000-000000000000" }, env.JWT_SECRET, {
            subject: String(session.user.id),
            issuer: "blog-api",
            audience: "blog-web",
            expiresIn: 60,
        });

        assert.equal((await me(token)).status, 401);
    });
});
