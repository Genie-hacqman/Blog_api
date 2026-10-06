import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs } from "./helpers.js";
import { PostDailyStats, PostReferrer, PostVisitor } from "../database/models/index.js";
import { env } from "../config/env.js";
import { addToDaily } from "../repositories/analyticsRepository.js";
import { purgeVisitors } from "../services/analyticsService.js";
import { addDays, setNowForTests, utcDay } from "../utils/clock.js";
import { MAX_REFERRERS_PER_POST_DAY, VIEW_WINDOW_MS } from "../config/analytics.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const MINUTE = 60 * 1000;

const publish = (owner, title, content = "<p>Some words to read.</p>") =>
    request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content, status: "published" });
// a browser: its user agent is what tells one visitor from another in these tests (every request comes from the same address)
const browser = (name) => `Mozilla/5.0 (Test; ${name}) Gecko/20100101`;
const send = (path, body, { agent = browser("default"), token, headers = {} } = {}) => {
    const call = request(app).post(`/api/analytics/${path}`).set("User-Agent", agent).set(headers);
    return (token ? call.set(bearer(token)) : call).send(body);
};
const view = (postId, options = {}, extra = {}) => send("view", { postId, ...extra }, options);
const reading = (postId, seconds, depth, options = {}) => send("reading", { postId, seconds, depth }, options);
const today = () => utcDay();
const stats = async (postId, day = today()) => (await PostDailyStats.findOne({ where: { postId, day }, raw: true })) ?? { views: 0, uniques: 0, readCount: 0, timed: 0, readSeconds: 0 };
const referrers = async (postId, day = today()) =>
    Object.fromEntries((await PostReferrer.findAll({ where: { postId, day }, raw: true })).map((row) => [row.host, row.views]));

after(closeDatabase);

describe("analytics: counting views", () => {
    let owner;
    let reader;
    let story;

    before(resetDatabase);
    before(async () => {
        owner = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        story = (await publish(owner, "Counted story")).body.data.post;
    });
    beforeEach(() => setNowForTests(null));
    after(() => setNowForTests(null));

    it("counts the first view as a view and a visitor, and says nothing else", async () => {
        const response = await view(story.id, { agent: browser("first") });
        await settleJobs();

        assert.equal(response.status, 204);
        assert.equal(response.text, "");
        assert.deepEqual([(await stats(story.id)).views, (await stats(story.id)).uniques], [1, 1]);
        assert.deepEqual(await referrers(story.id), { "(direct)": 1 });
    });

    it("does not count the same visitor again straight away, and does after the window has passed", async () => {
        const options = { agent: browser("first") };
        const start = new Date();
        setNowForTests(start);

        await view(story.id, options);
        await settleJobs();
        assert.equal((await stats(story.id)).views, 1, "a repeat inside the window is not another view");

        setNowForTests(new Date(start.getTime() + VIEW_WINDOW_MS - MINUTE));
        await view(story.id, options);
        await settleJobs();
        assert.equal((await stats(story.id)).views, 1, "still inside the window");

        setNowForTests(new Date(start.getTime() + VIEW_WINDOW_MS + MINUTE));
        await view(story.id, options);
        await settleJobs();
        const row = await stats(story.id);
        assert.deepEqual([row.views, row.uniques], [2, 1], "a new view, but the same visitor");
    });

    it("counts a different browser as another visitor", async () => {
        await view(story.id, { agent: browser("second") });
        await settleJobs();

        const row = await stats(story.id);
        assert.deepEqual([row.uniques, row.views >= 3], [2, true]);
    });

    it("answers 204 and counts nothing for the author, a draft, a missing story, a robot and a missing browser string", async () => {
        const draft = (await request(app).post("/api/posts").set(bearer(owner.token)).send({ title: "A draft", content: "<p>x</p>" })).body.data.post;
        const before = await stats(story.id);

        const responses = [
            await view(story.id, { agent: browser("author"), token: owner.token }),
            await view(draft.id, { agent: browser("draft") }),
            await view(999999, { agent: browser("missing") }),
            await view(story.id, { agent: "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
            await view(story.id, { agent: "" }),
        ];
        await settleJobs();

        for (const response of responses) assert.equal(response.status, 204);
        assert.deepEqual(await stats(story.id), before);
        assert.deepEqual(await stats(draft.id), { views: 0, uniques: 0, readCount: 0, timed: 0, readSeconds: 0 });
    });

    it("counts a signed-in reader like anyone else, and carries on when the token is expired or garbage", async () => {
        const before = (await stats(story.id)).views;

        const signedIn = await view(story.id, { agent: browser("signed-in"), token: reader.token });
        const garbage = await view(story.id, { agent: browser("garbage"), headers: { Authorization: "Bearer not.a.token" } });
        const wrongScheme = await view(story.id, { agent: browser("scheme"), headers: { Authorization: "Basic abc" } });
        await settleJobs();

        for (const response of [signedIn, garbage, wrongScheme]) assert.equal(response.status, 204);
        assert.equal((await stats(story.id)).views, before + 3);
    });

    it("counts a visitor who sent Do Not Track or Global Privacy Control as a view without making a code for them", async () => {
        const visitorsBefore = await PostVisitor.count({ where: { postId: story.id } });
        const before = await stats(story.id);

        await view(story.id, { agent: browser("dnt"), headers: { DNT: "1" } });
        await view(story.id, { agent: browser("gpc"), headers: { "Sec-GPC": "1" } });
        await settleJobs();

        const row = await stats(story.id);
        assert.deepEqual([row.views, row.uniques], [before.views + 2, before.uniques]);
        assert.equal(await PostVisitor.count({ where: { postId: story.id } }), visitorsBefore, "no visitor row for them");
    });

    it("stops counting when analytics are switched off", async () => {
        const before = await stats(story.id);
        env.ANALYTICS_ENABLED = false;
        try {
            assert.equal((await view(story.id, { agent: browser("off") })).status, 204);
            await settleJobs();
        } finally {
            env.ANALYTICS_ENABLED = true;
        }

        assert.deepEqual(await stats(story.id), before);
    });

    it("groups where readers came from by hostname only, and never keeps a path or a query", async () => {
        const target = (await publish(owner, "Referred story")).body.data.post;

        await view(target.id, { agent: browser("a") }, { referrer: "https://www.News.Example.com/a/b?token=secret#top" });
        await view(target.id, { agent: browser("b") }, { referrer: "https://news.example.com/other" });
        await view(target.id, { agent: browser("c") }, { referrer: `${env.APP_URL}/blog/something` });
        await view(target.id, { agent: browser("d") }, { referrer: "javascript:alert(1)" });
        await view(target.id, { agent: browser("e") }, { referrer: "not a url" });
        await view(target.id, { agent: browser("f") });
        await settleJobs();

        assert.deepEqual(await referrers(target.id), { "news.example.com": 2, "(internal)": 1, "(other)": 2, "(direct)": 1 });
        const stored = JSON.stringify(await PostReferrer.findAll({ where: { postId: target.id }, raw: true }));
        assert.ok(!stored.includes("secret") && !stored.includes("/a/b") && !stored.includes("token"));
    });

    it("keeps at most 50 different sources per story per day and counts the rest together", async () => {
        const target = (await publish(owner, "Many sources")).body.data.post;
        await PostReferrer.bulkCreate(Array.from({ length: MAX_REFERRERS_PER_POST_DAY }, (_, i) => ({ postId: target.id, day: today(), host: `site${i}.example.com`, views: 1 })));

        await view(target.id, { agent: browser("new-site") }, { referrer: "https://brand-new.example.net/" });
        await view(target.id, { agent: browser("old-site") }, { referrer: "https://site3.example.com/" });
        await settleJobs();

        const hosts = await referrers(target.id);
        assert.equal(hosts["(other)"], 1);
        assert.equal(hosts["site3.example.com"], 2, "a source already known keeps counting");
        assert.ok(!("brand-new.example.net" in hosts));
    });

    it("loses no counts when many readers arrive at the same moment", async () => {
        const target = (await publish(owner, "Busy story")).body.data.post;

        await Promise.all(Array.from({ length: 20 }, (_, i) => view(target.id, { agent: browser(`crowd-${i}`) })));
        await settleJobs();

        const row = await stats(target.id);
        assert.deepEqual([row.views, row.uniques], [20, 20]);
    });

    it("counts one visitor once when the same message arrives several times at once", async () => {
        const target = (await publish(owner, "Double click")).body.data.post;

        await Promise.all(Array.from({ length: 6 }, () => view(target.id, { agent: browser("eager") })));
        await settleJobs();

        const row = await stats(target.id);
        assert.deepEqual([row.views, row.uniques], [1, 1]);
    });

    it("counts the same visitor on the next day as a new visitor", async () => {
        const target = (await publish(owner, "Two days")).body.data.post;
        const morning = new Date("2026-04-10T09:00:00Z");
        setNowForTests(morning);
        await view(target.id, { agent: browser("returning") });
        await settleJobs(); // counting happens just after the answer: let it finish before the clock moves
        setNowForTests(new Date("2026-04-11T09:00:00Z"));
        await view(target.id, { agent: browser("returning") });
        await settleJobs();

        assert.deepEqual([(await stats(target.id, "2026-04-10")).uniques, (await stats(target.id, "2026-04-11")).uniques], [1, 1]);
        const codes = (await PostVisitor.findAll({ where: { postId: target.id }, raw: true })).map((row) => row.visitorHash);
        assert.equal(new Set(codes).size, 2, "the code differs from one day to the next");
    });

    it("refuses malformed messages with 400, and says nothing about anything well formed", async () => {
        for (const body of [{}, { postId: "7" }, { postId: -1 }, { postId: 1.5 }, { postId: 1, referrer: 5 }, { postId: 1, referrer: "x".repeat(2001) }, "nonsense"]) {
            assert.equal((await send("view", body)).status, 400, JSON.stringify(body).slice(0, 40));
        }
        for (const body of [{ postId: 1 }, { postId: 1, seconds: -1, depth: 10 }, { postId: 1, seconds: 3601, depth: 10 }, { postId: 1, seconds: 10, depth: 101 }, { postId: 1, seconds: "10", depth: 10 }]) {
            assert.equal((await send("reading", body)).status, 400, JSON.stringify(body).slice(0, 40));
        }
    });
});

describe("analytics: reading time and depth", () => {
    let owner;
    let reader;
    let story;

    before(resetDatabase);
    before(async () => {
        owner = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        story = (await publish(owner, "Read me")).body.data.post;
    });
    beforeEach(() => setNowForTests(null));

    const opened = async (name) => {
        const options = { agent: browser(name) };
        await view(story.id, options);
        await settleJobs();
        return options;
    };

    it("counts a read when the reader got far enough down and stayed long enough, and adds the time", async () => {
        const options = await opened("reader-one");

        assert.equal((await reading(story.id, 60, 90, options)).status, 204);
        await settleJobs();

        const row = await stats(story.id);
        assert.deepEqual([row.readCount, row.timed, row.readSeconds], [1, 1, 60]);
    });

    it("counts the time but not a read when the reader left early or did not scroll", async () => {
        const quick = await opened("reader-quick");
        const shallow = await opened("reader-shallow");
        const before = await stats(story.id);

        await reading(story.id, 5, 100, quick);
        await reading(story.id, 90, 40, shallow);
        await settleJobs();

        const row = await stats(story.id);
        assert.deepEqual([row.readCount, row.timed, row.readSeconds], [before.readCount, before.timed + 2, before.readSeconds + 95]);
    });

    it("takes a reader's report once, however many times it is sent", async () => {
        const options = await opened("reader-twice");
        const before = await stats(story.id);

        await Promise.all([reading(story.id, 100, 100, options), reading(story.id, 100, 100, options), reading(story.id, 200, 100, options)]);
        await settleJobs();

        const row = await stats(story.id);
        assert.deepEqual([row.timed, row.readCount], [before.timed + 1, before.readCount + 1]);
    });

    it("rounds fractional seconds", async () => {
        const options = await opened("reader-fraction");
        const before = await stats(story.id);

        await reading(story.id, 12.6, 10, options);
        await settleJobs();

        assert.equal((await stats(story.id)).readSeconds, before.readSeconds + 13);
    });

    it("ignores a report from someone who never opened the story, a robot, the author, and a visitor who asked not to be counted", async () => {
        const known = await opened("reader-known");
        const before = await stats(story.id);

        await reading(story.id, 100, 100, { agent: browser("never-opened") });
        await reading(story.id, 100, 100, { agent: "Googlebot/2.1" });
        await reading(story.id, 100, 100, { agent: browser("author"), token: owner.token });
        await reading(story.id, 100, 100, { ...known, headers: { DNT: "1" } });
        await settleJobs();

        assert.deepEqual(await stats(story.id), before);
        await reading(story.id, 100, 100, known);
        await settleJobs();
        assert.equal((await stats(story.id)).timed, before.timed + 1, "the real report still counts afterwards");
    });

    it("ignores a report for a story that is not published, without saying why", async () => {
        const draft = (await request(app).post("/api/posts").set(bearer(owner.token)).send({ title: "Hidden draft", content: "<p>x</p>" })).body.data.post;

        const response = await reading(draft.id, 100, 100, { agent: browser("peeker"), token: reader.token });
        await settleJobs();

        assert.equal(response.status, 204);
        assert.equal((await stats(draft.id)).timed, 0);
    });

    it("asks for more time on a longer story", async () => {
        const long = (await publish(owner, "A long story", `<p>${"word ".repeat(900)}</p>`)).body.data.post;
        const options = { agent: browser("reader-long") };
        await view(long.id, options);
        await settleJobs();

        await reading(long.id, 30, 100, options);
        await settleJobs();

        assert.equal((await stats(long.id)).readCount, 0, "30 seconds is too little for a four-minute story (it needs 60)");
    });
});

describe("analytics: privacy", () => {
    let owner;
    let story;

    before(resetDatabase);
    before(async () => {
        owner = await registerAndLogin({ role: "editor" });
        story = (await publish(owner, "Private by design")).body.data.post;
    });
    beforeEach(() => setNowForTests(null));
    after(() => setNowForTests(null));

    it("stores no address, no browser string, no account and no cookie value anywhere", async () => {
        const marker = "PrivacyProbe/9.9 (very-identifying-marker)";
        const reader = await registerAndLogin({ role: "user" });
        await view(story.id, { agent: marker, token: reader.token, headers: { Cookie: "session=cookie-secret-value", "X-Forwarded-For": "198.51.100.77" } }, { referrer: "https://friend.example.org/page?user=alice" });
        await reading(story.id, 40, 100, { agent: marker, token: reader.token });
        await settleJobs();

        const everything = JSON.stringify([
            ...(await PostVisitor.findAll({ raw: true })),
            ...(await PostDailyStats.findAll({ raw: true })),
            ...(await PostReferrer.findAll({ raw: true })),
        ]);
        for (const secret of [marker, "very-identifying", "198.51.100.77", "127.0.0.1", "cookie-secret-value", reader.credentials.email, reader.credentials.userName, "alice", "/page"]) {
            assert.ok(!everything.includes(secret), `${secret} must not be stored`);
        }
        assert.ok((await PostVisitor.findAll({ raw: true })).every((row) => /^[0-9a-f]{32}$/.test(row.visitorHash)));
    });

    it("deletes the visitor codes after two days and keeps the totals", async () => {
        const target = (await publish(owner, "Purged")).body.data.post;
        for (const day of ["2026-05-01", "2026-05-03", "2026-05-04"]) {
            setNowForTests(new Date(`${day}T10:00:00Z`));
            await view(target.id, { agent: browser(`visitor-${day}`) });
            await settleJobs();
        }
        setNowForTests(new Date("2026-05-04T23:00:00Z"));

        const removed = await purgeVisitors();

        assert.equal(removed, 1, "only the first day is older than yesterday: today and yesterday are kept");
        assert.deepEqual((await PostVisitor.findAll({ where: { postId: target.id }, raw: true })).map((row) => row.day).sort(), ["2026-05-03", "2026-05-04"]);
        for (const day of ["2026-05-01", "2026-05-03", "2026-05-04"]) assert.equal((await stats(target.id, day)).views, 1, `${day} totals stay`);
    });

    it("deletes the numbers of a story with the story", async () => {
        const doomed = (await publish(owner, "Short lived")).body.data.post;
        await view(doomed.id, { agent: browser("last-visitor") });
        await settleJobs();
        assert.equal(await PostDailyStats.count({ where: { postId: doomed.id } }), 1);

        await request(app).delete(`/api/posts/${doomed.id}`).set(bearer(owner.token));

        for (const model of [PostDailyStats, PostVisitor, PostReferrer]) assert.equal(await model.count({ where: { postId: doomed.id } }), 0);
    });
});

describe("analytics: reading the numbers", () => {
    let admin;
    let author;
    let other;
    let editor;
    let reader;
    let mine;
    let second;
    let quiet;
    let theirs;
    const day = (offset) => addDays(today(), offset);

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        author = await registerAndLogin({ role: "editor" });
        other = await registerAndLogin({ role: "editor" });
        editor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        mine = (await publish(author, "My best story")).body.data.post;
        second = (await publish(author, "My second story")).body.data.post;
        quiet = (await publish(author, "Nobody read this")).body.data.post;
        theirs = (await publish(other, "Someone else's story")).body.data.post;
        await addToDaily({ postId: mine.id, day: day(0), views: 10, uniques: 8, readCount: 4, timed: 6, readSeconds: 600 });
        await addToDaily({ postId: mine.id, day: day(-3), views: 5, uniques: 5, readCount: 1, timed: 2, readSeconds: 90 });
        await addToDaily({ postId: mine.id, day: day(-20), views: 7, uniques: 7, readCount: 2, timed: 3, readSeconds: 150 });
        await addToDaily({ postId: second.id, day: day(0), views: 3, uniques: 3 });
        await addToDaily({ postId: theirs.id, day: day(0), views: 50, uniques: 40, readCount: 10, timed: 10, readSeconds: 1000 });
        await sequelize.query("INSERT INTO `post_referrers_daily` (postId, day, host, views) VALUES (:a, :d, 'news.example.com', 6), (:a, :d, '(direct)', 9), (:t, :d, 'other.example.org', 40)", {
            replacements: { a: mine.id, t: theirs.id, d: day(0) },
        });
        await request(app).put(`/api/posts/${mine.id}/like`).set(bearer(reader.token));
        await request(app).put(`/api/posts/${mine.id}/bookmark`).set(bearer(reader.token));
        await request(app).post(`/api/posts/${mine.id}/comments`).set(bearer(reader.token)).send({ body: "Nice" });
    });

    const me = (who, query = "") => request(app).get(`/api/analytics/me${query}`).set(bearer(who.token));
    const one = (who, id, query = "") => request(app).get(`/api/analytics/posts/${id}${query}`).set(bearer(who.token));

    it("gives an author their totals, a day-by-day series with every day present, and their stories ranked", async () => {
        const response = await me(author, "?days=7");

        assert.equal(response.status, 200);
        const { analytics } = response.body.data;
        assert.deepEqual([analytics.range.days, analytics.range.to], [7, day(0)]);
        assert.equal(analytics.series.length, 7);
        assert.deepEqual(analytics.series.map((d) => d.day), Array.from({ length: 7 }, (_, i) => day(i - 6)));
        assert.deepEqual(analytics.series.at(-1), { day: day(0), views: 13, visitors: 11, reads: 4 });
        assert.deepEqual(analytics.series.find((d) => d.day === day(-3)), { day: day(-3), views: 5, visitors: 5, reads: 1 });
        assert.deepEqual(analytics.series.find((d) => d.day === day(-1)), { day: day(-1), views: 0, visitors: 0, reads: 0 }, "an empty day is zeros, not missing");
        assert.deepEqual(analytics.totals, { views: 18, visitors: 16, reads: 5, avgReadSeconds: 86, readRate: 0.313 });
        assert.deepEqual(analytics.stories.map((s) => [s.title, s.views]), [["My best story", 15], ["My second story", 3], ["Nobody read this", 0]]);
        assert.deepEqual(analytics.stories[0], { id: mine.id, title: "My best story", slug: mine.slug, views: 15, visitors: 13, reads: 5, avgReadSeconds: 86 });
        assert.equal(analytics.stories[2].avgReadSeconds, null);
        assert.deepEqual(analytics.sources, [{ host: "(direct)", views: 9 }, { host: "news.example.com", views: 6 }]);
        assert.deepEqual(analytics.reactions, { likes: 1, comments: 1 });
    });

    it("never includes someone else's story in an author's numbers", async () => {
        const { analytics } = (await me(author, "?days=30")).body.data;

        assert.ok(!analytics.stories.some((s) => s.id === theirs.id));
        assert.equal(analytics.totals.views, 25, "10 + 5 + 7 + 3 from this author's stories, not the 50 of the other");
    });

    it("widens the range, and refuses ranges that are not on offer", async () => {
        assert.equal((await me(author, "?days=90")).body.data.analytics.series.length, 90);
        assert.equal((await me(author)).body.data.analytics.range.days, 30, "30 days by default");
        assert.equal((await me(author, "?days=7")).body.data.analytics.totals.views, 18);
        assert.equal((await me(author, "?days=30")).body.data.analytics.totals.views, 25);
        for (const bad of ["?days=14", "?days=0", "?days=-7", "?days=abc", "?days=7.5", "?days=1000"]) {
            assert.equal((await me(author, bad)).status, 400, bad);
        }
    });

    it("gives the numbers of one story to its author, with where readers came from and what they did", async () => {
        const response = await one(author, mine.id, "?days=7");

        assert.equal(response.status, 200);
        const { analytics } = response.body.data;
        assert.deepEqual(analytics.post, { id: mine.id, title: "My best story", slug: mine.slug, status: "published" });
        assert.equal(analytics.series.length, 7);
        assert.deepEqual(analytics.totals, { views: 15, visitors: 13, reads: 5, avgReadSeconds: 86, readRate: 0.385 });
        assert.deepEqual(analytics.sources, [{ host: "(direct)", views: 9 }, { host: "news.example.com", views: 6 }]);
        assert.deepEqual(analytics.reactions, { likes: 1, comments: 1, bookmarks: 1 });
    });

    it("shows a story nobody read as zeros and no averages", async () => {
        const { analytics } = (await one(author, quiet.id)).body.data;

        assert.deepEqual(analytics.totals, { views: 0, visitors: 0, reads: 0, avgReadSeconds: null, readRate: null });
        assert.ok(analytics.series.every((d) => d.views === 0));
        assert.deepEqual(analytics.sources, []);
    });

    it("tells anyone but the owner, and admins, that a story does not exist", async () => {
        assert.equal((await one(other, mine.id)).status, 404);
        assert.equal((await one(editor, mine.id)).status, 404);
        assert.equal((await one(author, 999999)).status, 404);
        assert.equal((await request(app).get("/api/analytics/posts/abc").set(bearer(author.token))).status, 404);
        assert.equal((await one(admin, mine.id)).status, 200, "an admin can read any story's numbers");
        assert.equal((await one(admin, theirs.id)).body.data.analytics.totals.views, 50);
    });

    it("is closed to readers who do not write, and to visitors who are not logged in", async () => {
        assert.equal((await me(reader)).status, 403);
        assert.equal((await one(reader, mine.id)).status, 403);
        assert.equal((await request(app).get("/api/analytics/me")).status, 401);
        assert.equal((await request(app).get(`/api/analytics/posts/${mine.id}`)).status, 401);
    });

    it("gives admins the site: reading, growth, and what leads", async () => {
        const response = await request(app).get("/api/admin/analytics?days=7").set(bearer(admin.token));

        assert.equal(response.status, 200);
        const { analytics } = response.body.data;
        assert.equal(analytics.series.length, 7);
        const last = analytics.series.at(-1);
        assert.deepEqual([last.views, last.visitors, last.reads], [63, 51, 14]);
        assert.ok(last.signups >= 5, "the accounts made for this test were created today");
        assert.equal(last.published, 4);
        assert.equal(last.comments, 1);
        assert.equal(analytics.totals.views, 68);
        assert.equal(analytics.totals.signups, last.signups);
        assert.deepEqual(analytics.stories.map((s) => s.title), ["Someone else's story", "My best story", "My second story"]);
        assert.deepEqual(analytics.authors.map((a) => [a.username, a.views]), [[other.credentials.userName, 50], [author.credentials.userName, 18]]);
        assert.deepEqual(analytics.sources[0], { host: "other.example.org", views: 40 });
    });

    it("keeps the site's numbers for admins only", async () => {
        for (const who of [author, editor, reader]) assert.equal((await request(app).get("/api/admin/analytics").set(bearer(who.token))).status, 403);
        assert.equal((await request(app).get("/api/admin/analytics")).status, 401);
        assert.equal((await request(app).get("/api/admin/analytics?days=5").set(bearer(admin.token))).status, 400);
    });

    it("limits the top lists to ten", async () => {
        for (let i = 0; i < 12; i += 1) {
            const extra = (await publish(other, `Extra ${i}`)).body.data.post;
            await addToDaily({ postId: extra.id, day: day(0), views: 100 + i, uniques: 1 });
        }

        const { analytics } = (await request(app).get("/api/admin/analytics?days=7").set(bearer(admin.token))).body.data;

        assert.equal(analytics.stories.length, 10);
        assert.deepEqual(analytics.stories.map((s) => s.views), [...analytics.stories.map((s) => s.views)].sort((a, b) => b - a));
    });

    it("costs the same number of queries for an author with many stories as for one with few", async () => {
        const busy = await registerAndLogin({ role: "editor" });
        const few = await registerAndLogin({ role: "editor" });
        for (let i = 0; i < 8; i += 1) await publish(busy, `Busy ${i}`);
        await publish(few, "Only one");
        await settleJobs();
        const count = async (who) => {
            let queries = 0;
            const hook = () => {
                queries += 1;
            };
            sequelize.addHook("beforeQuery", hook);
            try {
                assert.equal((await me(who)).status, 200);
            } finally {
                sequelize.removeHook("beforeQuery", hook);
            }
            return queries;
        };

        const small = await count(few);
        const large = await count(busy);

        assert.ok(small >= 5, `the counter should see the queries (saw ${small})`);
        assert.equal(small, large);
    });
});
