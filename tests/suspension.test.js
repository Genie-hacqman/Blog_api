import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs, COOKIE_HEADERS } from "./helpers.js";
import { AuditLog, Post, Report, User } from "../database/models/index.js";
import { clearSentEmails, sentEmails } from "../providers/email/memory.js";
import { publishDuePosts } from "../jobs/publishScheduled.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const name = (account) => account.credentials.userName;
const suspend = (who, id, body) => request(app).post(`/api/admin/users/${id}/suspend`).set(who ? bearer(who.token) : {}).send(body);
const unsuspend = (who, id) => request(app).post(`/api/admin/users/${id}/unsuspend`).set(bearer(who.token));
const signOut = (who, id) => request(app).post(`/api/admin/users/${id}/sign-out`).set(bearer(who.token));
const users = (who, query = "") => request(app).get(`/api/admin/users${query}`).set(who ? bearer(who.token) : {});
const login = (account) => request(app).post("/api/auth/login").send({ email: account.credentials.email, password: account.credentials.password });
const refresh = (account) => request(app).post("/api/auth/refresh").set(COOKIE_HEADERS).set("Cookie", account.cookie);

after(closeDatabase);

describe("suspending an account", () => {
    let admin;
    let admin2;
    let editor;
    let victim;

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        admin2 = await registerAndLogin({ role: "admin" });
        editor = await registerAndLogin({ role: "editor" });
        victim = await registerAndLogin({ role: "author" });
    });

    it("ends the person's sessions at once, tells them why when they try to log in, and emails them", async () => {
        clearSentEmails();
        assert.equal((await request(app).get("/api/auth/me").set(bearer(victim.token))).status, 200);

        const response = await suspend(admin, victim.user.id, { reason: "  Repeated harassment of other readers.  " });

        assert.equal(response.status, 200);
        assert.deepEqual([response.body.data.user.status, response.body.data.user.suspendedReason], ["suspended", "Repeated harassment of other readers."]);
        assert.equal((await request(app).get("/api/auth/me").set(bearer(victim.token))).status, 401, "the old access token stops working immediately");
        assert.equal((await refresh(victim)).status, 401, "and so does the refresh cookie");
        const attempt = await login(victim);
        assert.equal(attempt.status, 403);
        assert.equal(attempt.body.error.code, "ACCOUNT_SUSPENDED");
        assert.match(attempt.body.error.message, /Repeated harassment of other readers\./);
        const mail = sentEmails.find((m) => m.to === victim.credentials.email && /suspended/.test(m.subject));
        assert.ok(mail.text.includes("Repeated harassment of other readers."));
        assert.ok(!mail.html.includes("<script"));
    });

    it("does not tell someone guessing the password why an account is suspended", async () => {
        const wrong = await request(app).post("/api/auth/login").send({ email: victim.credentials.email, password: "not the password" });

        assert.equal(wrong.status, 401);
        assert.ok(!JSON.stringify(wrong.body).includes("Repeated"));
    });

    it("records who did it and why, and nothing secret", async () => {
        const row = await AuditLog.findOne({ where: { action: "user.suspended", entityId: String(victim.user.id) } });

        assert.deepEqual([row.actorId, row.metadata.reason], [admin.user.id, "Repeated harassment of other readers."]);
        assert.ok(!/pass|token|secret|hash|cookie/i.test(JSON.stringify(row.metadata)));
    });

    it("lets the same admin or another lift it, restoring access and emailing the person", async () => {
        clearSentEmails();

        const response = await unsuspend(admin2, victim.user.id);

        assert.equal(response.status, 200);
        assert.deepEqual([response.body.data.user.status, response.body.data.user.suspendedReason], ["active", null]);
        assert.equal((await login(victim)).status, 200);
        assert.ok(sentEmails.some((m) => m.to === victim.credentials.email && /active again/.test(m.subject)));
        assert.ok(await AuditLog.findOne({ where: { action: "user.unsuspended", entityId: String(victim.user.id), actorId: admin2.user.id } }));
    });

    it("refuses without a reason, with a reason that is too long, to non-admins, and to anonymous callers", async () => {
        const target = await registerAndLogin({ role: "user" });
        const bystander = await registerAndLogin({ role: "author" });

        for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "x".repeat(501) }, { reason: 5 }]) {
            assert.equal((await suspend(admin, target.user.id, body)).status, 400, JSON.stringify(body).slice(0, 40));
        }
        assert.equal((await suspend(editor, target.user.id, { reason: "x" })).status, 403);
        assert.equal((await suspend(bystander, target.user.id, { reason: "x" })).status, 403);
        assert.equal((await suspend(null, target.user.id, { reason: "x" })).status, 401);
        assert.equal((await unsuspend(editor, target.user.id)).status, 403);
        assert.equal((await User.findByPk(target.user.id)).status, "active");
    });

    it("answers 404 for missing people, 409 for double suspension, and 409 for lifting a suspension that is not there", async () => {
        const target = await registerAndLogin({ role: "user" });

        assert.equal((await suspend(admin, 999999, { reason: "x" })).status, 404);
        assert.equal((await request(app).post("/api/admin/users/abc/suspend").set(bearer(admin.token)).send({ reason: "x" })).status, 404);
        assert.equal((await unsuspend(admin, target.user.id)).status, 409);
        assert.equal((await suspend(admin, target.user.id, { reason: "first" })).status, 200);
        assert.equal((await suspend(admin, target.user.id, { reason: "second" })).status, 409);
    });

    it("never lets an admin suspend themselves, and two admins suspending each other cannot leave none", async () => {
        assert.equal((await suspend(admin, admin.user.id, { reason: "x" })).status, 403);

        await Promise.all([suspend(admin, admin2.user.id, { reason: "race one" }), suspend(admin2, admin.user.id, { reason: "race two" })]);

        assert.ok((await User.count({ where: { role: "admin", status: "active" } })) >= 1);
        await User.update({ status: "active", suspendedAt: null, suspendedReason: null }, { where: { role: "admin" } });
    });

    it("keeps a suspended person's published stories up, hides their profile, and holds their scheduled stories until they return", async () => {
        const writer = await registerAndLogin({ role: "editor" });
        const live = (await request(app).post("/api/posts").set(bearer(writer.token)).send({ title: "Already live", content: "<p>x</p>", status: "published" })).body.data.post;
        const later = (await request(app).post("/api/posts").set(bearer(writer.token)).send({ title: "Due soon", content: "<p>x</p>" })).body.data.post;
        await Post.update({ status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) }, { where: { id: later.id } });

        await suspend(admin, writer.user.id, { reason: "Under review" });
        await publishDuePosts();

        assert.equal((await request(app).get(`/api/posts/${live.id}`)).status, 200);
        assert.equal((await request(app).get(`/api/users/${name(writer)}`)).status, 404);
        assert.equal((await Post.findByPk(later.id)).status, "scheduled", "not published while the account is suspended");

        await unsuspend(admin, writer.user.id);
        await publishDuePosts();
        assert.equal((await Post.findByPk(later.id)).status, "published");
    });

    it("can sign a person out everywhere without suspending them", async () => {
        const person = await registerAndLogin({ role: "user" });

        const response = await signOut(admin, person.user.id);

        assert.equal(response.status, 200);
        assert.ok(response.body.data.sessions >= 1);
        assert.equal((await request(app).get("/api/auth/me").set(bearer(person.token))).status, 401);
        assert.equal((await refresh(person)).status, 401);
        assert.equal((await login(person)).status, 200, "they can log in again");
        assert.ok(await AuditLog.findOne({ where: { action: "user.sessions_revoked", entityId: String(person.user.id) } }));
        assert.equal((await signOut(editor, person.user.id)).status, 403);
        assert.equal((await signOut(admin, 999999)).status, 404);
    });
});

describe("the admin's view of people and the site", () => {
    let admin;
    let editor;
    let a;
    let b;
    let c;

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        editor = await registerAndLogin({ role: "editor" });
        a = await registerAndLogin({ role: "author", userName: "findme_alpha" });
        b = await registerAndLogin({ role: "user", userName: "findme_beta" });
        c = await registerAndLogin({ role: "user", userName: "other_gamma", verified: false });
        await User.update({ status: "suspended" }, { where: { id: c.user.id } });
    });

    it("searches by the start of a username or an email address, or by id, and filters", async () => {
        const names = async (query) => (await users(admin, query)).body.data.users.map((u) => u.username).sort();

        assert.deepEqual(await names("?q=findme"), ["findme_alpha", "findme_beta"]);
        assert.deepEqual(await names(`?q=${encodeURIComponent(a.credentials.email)}`), [name(a)]);
        assert.deepEqual(await names(`?q=${encodeURIComponent(a.credentials.email.slice(0, -5))}`), [name(a)], "the start of an address is enough");
        assert.deepEqual(await names(`?q=${b.user.id}`), [name(b)]);
        assert.deepEqual(await names("?role=author"), ["findme_alpha"]);
        assert.deepEqual(await names("?status=suspended"), ["other_gamma"]);
        assert.deepEqual(await names("?verified=false"), ["other_gamma"]);
        assert.deepEqual(await names("?q=findme&role=user"), ["findme_beta"]);
        assert.deepEqual(await names("?q=%25"), [], "a percent sign is a character, not a wildcard");
        assert.equal((await users(admin, "?role=wizard")).status, 400);
    });

    it("shows what an admin needs and never a password", async () => {
        const [first] = (await users(admin, `?q=${name(a)}`)).body.data.users;

        assert.deepEqual(Object.keys(first).sort(), ["createdAt", "email", "emailVerified", "firstName", "id", "lastLoginAt", "lastName", "role", "status", "suspendedAt", "suspendedReason", "username"]);
        assert.ok(!JSON.stringify((await users(admin)).body).toLowerCase().includes("password"));
    });

    it("pages the list, and is closed to everyone but admins", async () => {
        const page = await users(admin, "?limit=2&page=2");

        assert.equal(page.body.data.users.length, 2);
        assert.deepEqual(page.body.meta.pagination, { page: 2, limit: 2, total: 5, totalPages: 3 });
        assert.equal((await users(editor)).status, 403);
        assert.equal((await users(null)).status, 401);
        assert.equal((await request(app).get("/api/admin/stats").set(bearer(editor.token))).status, 403);
    });

    it("gives one person's detail with counts of what they wrote and reports against them", async () => {
        const story = (await request(app).post("/api/posts").set(bearer(editor.token)).send({ title: "Counted", content: "<p>x</p>", status: "published" })).body.data.post;
        await request(app).post(`/api/posts/${story.id}/comments`).set(bearer(b.token)).send({ body: "hello" });
        await request(app).post("/api/reports").set(bearer(a.token)).send({ targetType: "user", targetId: name(b), reason: "spam" });

        const response = await request(app).get(`/api/admin/users/${b.user.id}`).set(bearer(admin.token));

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data.user.counts, { posts: 0, comments: 1, openReports: 1 });
        assert.equal((await request(app).get("/api/admin/users/999999").set(bearer(admin.token))).status, 404);
        assert.equal((await request(app).get(`/api/admin/users/${b.user.id}`).set(bearer(editor.token))).status, 403);
    });

    it("reports the numbers of the site, matching the database", async () => {
        const pending = (await request(app).post("/api/posts").set(bearer(a.token)).send({ title: "Waiting", content: "<p>x</p>" })).body.data.post;
        await request(app).post(`/api/posts/${pending.id}/status`).set(bearer(a.token)).send({ to: "pending_review" });
        await request(app).post("/api/reports").set(bearer(b.token)).send({ targetType: "user", targetId: name(a), reason: "spam" });
        await settleJobs();

        const { stats } = (await request(app).get("/api/admin/stats").set(bearer(admin.token))).body.data;

        assert.deepEqual([stats.users.total, stats.users.active, stats.users.suspended], [5, 4, 1]);
        assert.deepEqual(stats.users.byRole, { user: 2, author: 1, editor: 1, admin: 1 });
        assert.equal(stats.users.newLast7Days, 5);
        assert.equal(stats.posts.byStatus.published, 1);
        assert.equal(stats.posts.byStatus.pending_review, 1);
        assert.equal(stats.reviewQueue, 1);
        assert.equal(stats.comments.total, 1);
        assert.equal(stats.reports.openTargets, 2);
        assert.equal(await Report.count({ where: { status: "open" } }), 2);
        assert.ok(stats.recentActivity.length > 0 && stats.recentActivity.length <= 8);
        const times = stats.recentActivity.map((entry) => new Date(entry.createdAt).getTime());
        assert.deepEqual(times, [...times].sort((x, y) => y - x), "newest first");
    });

    it("lets the audit log be narrowed to one thing", async () => {
        await suspend(admin, b.user.id, { reason: "audit filter" });

        const response = await request(app).get(`/api/admin/audit-logs?entityType=user&entityId=${b.user.id}`).set(bearer(admin.token));

        assert.ok(response.body.data.logs.length >= 1);
        assert.ok(response.body.data.logs.every((entry) => entry.entityType === "user" && entry.entityId === String(b.user.id)));
        const none = await request(app).get("/api/admin/audit-logs?entityType=user&entityId=not-a-number").set(bearer(admin.token));
        assert.equal(none.status, 200, "a malformed id filter is ignored, not an error");
    });

    it("costs the same number of queries for a long page of people as for a short one", async () => {
        for (let i = 0; i < 6; i += 1) await registerAndLogin({ role: "user" });
        const count = async (limit) => {
            let queries = 0;
            const hook = () => {
                queries += 1;
            };
            sequelize.addHook("beforeQuery", hook);
            try {
                assert.equal((await users(admin, `?limit=${limit}`)).status, 200);
            } finally {
                sequelize.removeHook("beforeQuery", hook);
            }
            return queries;
        };
        await settleJobs();

        const small = await count(2);
        const large = await count(10);

        assert.ok(small >= 2, `the counter should see the queries (saw ${small})`);
        assert.equal(small, large);
    });
});
