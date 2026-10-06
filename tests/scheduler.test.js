import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Post } from "../database/models/index.js";
import { publishDuePosts } from "../jobs/publishScheduled.js";
import { startScheduler } from "../jobs/scheduler.js";
import { env } from "../config/env.js";

const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60_000);

describe("scheduled publishing", () => {
    let author;
    let counter = 0;

    before(resetDatabase);
    after(closeDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "editor" });
    });
    beforeEach(async () => {
        await Post.destroy({ where: {} });
        await AuditLog.destroy({ where: { action: "post.published_on_schedule" } });
    });

    const scheduled = async (scheduledAt, extra = {}) => {
        counter += 1;
        return Post.create({
            title: `Scheduled ${counter}`, content: "Body text.", userId: author.user.id, status: "scheduled", scheduledAt,
            slug: `scheduled-${counter}`, excerpt: "Body text.", readingTime: 1, ...extra,
        });
    };

    it("publishes posts whose time has come, at the time the author chose", async () => {
        const when = minutesFromNow(-30);
        when.setMilliseconds(0);
        const due = await scheduled(when);

        const count = await publishDuePosts();

        assert.equal(count, 1);
        const stored = await Post.findByPk(due.id);
        assert.equal(stored.status, "published");
        assert.equal(stored.publishedAt.getTime(), when.getTime(), "published at the scheduled time, not whenever the job ran");
        assert.equal(stored.scheduledAt, null);
        const publicRead = await request(app).get(`/api/posts/slug/${due.slug}`);
        assert.equal(publicRead.status, 200);
        assert.ok((await request(app).get("/api/posts")).body.data.posts.some((p) => p.id === due.id));
    });

    it("leaves future posts, drafts and already published posts alone", async () => {
        const future = await scheduled(minutesFromNow(60));
        const draftWithStaleDate = await scheduled(minutesFromNow(-60), { status: "draft" });
        const published = await scheduled(minutesFromNow(-60), { status: "published", publishedAt: new Date("2020-01-01T00:00:00Z") });

        assert.equal(await publishDuePosts(), 0);

        assert.equal((await Post.findByPk(future.id)).status, "scheduled");
        assert.equal((await Post.findByPk(draftWithStaleDate.id)).status, "draft");
        assert.equal((await Post.findByPk(published.id)).publishedAt.getFullYear(), 2020);
    });

    it("is safe to run again: a post is published once", async () => {
        await scheduled(minutesFromNow(-5));

        assert.equal(await publishDuePosts(), 1);
        assert.equal(await publishDuePosts(), 0);
        assert.equal(await AuditLog.count({ where: { action: "post.published_on_schedule" } }), 1);
    });

    it("records each publication in the audit log with no actor", async () => {
        const due = await scheduled(minutesFromNow(-5));

        await publishDuePosts();

        const entry = await AuditLog.findOne({ where: { action: "post.published_on_schedule", entityId: String(due.id) } });
        assert.equal(entry.actorId, null);
        assert.equal(entry.metadata.from, "scheduled");
        assert.equal(entry.metadata.to, "published");
        assert.ok(entry.metadata.scheduledFor);
    });

    it("keeps an earlier first-publication time if the post was published before", async () => {
        const first = new Date("2025-03-01T10:00:00Z");
        const due = await scheduled(minutesFromNow(-5), { publishedAt: first });

        await publishDuePosts();

        assert.equal((await Post.findByPk(due.id)).publishedAt.getTime(), first.getTime());
    });

    it("publishes each post exactly once when several workers run at the same moment", async () => {
        for (let i = 0; i < 30; i += 1) await scheduled(minutesFromNow(-10 - i));

        const counts = await Promise.all([publishDuePosts(), publishDuePosts(), publishDuePosts()]);

        assert.equal(counts.reduce((a, b) => a + b, 0), 30);
        assert.equal(await Post.count({ where: { status: "published" } }), 30);
        assert.equal(await AuditLog.count({ where: { action: "post.published_on_schedule" } }), 30, "no duplicate audit rows");
    });

    it("works through more than one batch", async () => {
        const rows = Array.from({ length: 130 }, (_, i) => ({
            title: `Bulk ${i}`, content: "Body.", userId: author.user.id, status: "scheduled", scheduledAt: minutesFromNow(-5),
            slug: `bulk-${i}`, excerpt: "Body.", readingTime: 1,
        }));
        await Post.bulkCreate(rows);

        assert.equal(await publishDuePosts(), 130);
        assert.equal(await Post.count({ where: { status: "scheduled" } }), 0);
    });

    it("runs on a timer, catches up at start, and stops when told to", async () => {
        const due = await scheduled(minutesFromNow(-5));
        const original = env.SCHEDULER_INTERVAL_SECONDS;
        env.SCHEDULER_INTERVAL_SECONDS = 0.05;

        const stop = startScheduler();
        try {
            for (let i = 0; i < 60 && (await Post.findByPk(due.id)).status !== "published"; i += 1) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            assert.equal((await Post.findByPk(due.id)).status, "published");

            stop();
            const later = await scheduled(minutesFromNow(-1));
            await new Promise((resolve) => setTimeout(resolve, 300));
            assert.equal((await Post.findByPk(later.id)).status, "scheduled", "a stopped scheduler does nothing");
        } finally {
            stop();
            env.SCHEDULER_INTERVAL_SECONDS = original;
        }
    });
});
