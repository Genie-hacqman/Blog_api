import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs } from "./helpers.js";
import { Notification, NotificationPreference, Post, User } from "../database/models/index.js";
import { getQueue } from "../providers/queue/index.js";
import { handleEvent } from "../services/notificationService.js";
import { publishDuePosts } from "../jobs/publishScheduled.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const publish = (owner, title = "A story") =>
    request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content: "<p>Some words to read.</p>", status: "published" });
const draft = (owner, title = "Draft story") => request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content: "<p>Words.</p>" });
const move = (who, postId, body) => request(app).post(`/api/posts/${postId}/status`).set(bearer(who.token)).send(body);
const comment = (who, postId, body, parentId) => request(app).post(`/api/posts/${postId}/comments`).set(bearer(who.token)).send({ body, ...(parentId && { parentId }) });
const follow = (who, username) => request(app).put(`/api/users/${username}/follow`).set(bearer(who.token));
const unfollow = (who, username) => request(app).delete(`/api/users/${username}/follow`).set(bearer(who.token));
const inbox = async (who, query = "") => {
    await settleJobs();
    return request(app).get(`/api/notifications${query}`).set(bearer(who.token));
};
const types = async (who, query) => (await inbox(who, query)).body.data.notifications.map((n) => n.type);

after(closeDatabase);

describe("notifications: who is told what", () => {
    let editor1;
    let editor2;
    let author;
    let reader1;
    let reader2;
    let story;

    before(resetDatabase);
    before(async () => {
        editor1 = await registerAndLogin({ role: "editor" });
        editor2 = await registerAndLogin({ role: "editor" });
        author = await registerAndLogin({ role: "author" });
        reader1 = await registerAndLogin({ role: "user" });
        reader2 = await registerAndLogin({ role: "user" });
        story = (await publish(editor1, "Owned by editor one")).body.data.post;
    });

    it("tells a story's author about a comment, naming who wrote it and showing the start of it", async () => {
        await comment(reader1, story.id, "What a lovely piece of writing.");

        const response = await inbox(editor1);

        assert.equal(response.status, 200);
        const [n] = response.body.data.notifications;
        assert.equal(n.type, "comment_on_post");
        assert.equal(n.actor.username, reader1.credentials.userName);
        assert.deepEqual(n.post, { id: story.id, slug: story.slug, title: "Owned by editor one" });
        assert.equal(n.comment.excerpt, "What a lovely piece of writing.");
        assert.equal(n.readAt, null);
        assert.equal(response.body.meta.unreadCount, 1);
    });

    it("says nothing about your own comments", async () => {
        const mine = (await publish(editor2, "Editor two writes")).body.data.post;

        await comment(editor2, mine.id, "Commenting on my own story.");

        assert.deepEqual(await types(editor2), []);
    });

    it("tells the author of a comment about a reply, and a story's author hears once, as a reply, when it is a reply to their own comment", async () => {
        const post = (await publish(editor1, "Thread story")).body.data.post;
        const first = (await comment(reader1, post.id, "Top comment")).body.data.comment;
        await comment(reader2, post.id, "A reply to reader one", first.id);
        const ownTop = (await comment(editor1, post.id, "The author's own comment")).body.data.comment;
        await comment(reader2, post.id, "A reply to the author", ownTop.id);

        const forReader1 = (await inbox(reader1)).body.data.notifications;
        assert.deepEqual(forReader1.map((n) => n.type), ["comment_reply"]);
        assert.equal(forReader1[0].comment.parentId, first.id);

        const forEditor1 = (await inbox(editor1)).body.data.notifications.filter((n) => n.post.id === post.id);
        // reader one's top comment (on the author's story), reader two's reply to reader one (also on the author's story),
        // and the reply to the author's own comment: the last is a reply, never also "on your story"
        assert.deepEqual(forEditor1.map((n) => n.type).sort(), ["comment_on_post", "comment_on_post", "comment_reply"]);
        assert.equal(forEditor1.filter((n) => n.comment.excerpt === "A reply to the author").length, 1);
    });

    it("tells someone once about a new follower, however often they follow and unfollow", async () => {
        const name = reader2.credentials.userName;

        await follow(reader1, name);
        await unfollow(reader1, name);
        await follow(reader1, name);
        await follow(reader1, name);

        const notes = (await inbox(reader2)).body.data.notifications.filter((n) => n.type === "new_follower");
        assert.equal(notes.length, 1);
        assert.equal(notes[0].actor.username, reader1.credentials.userName);
        assert.equal(notes[0].post, null);
    });

    it("tells every editor about a story waiting for review, but not its author, and tells the author of the decision", async () => {
        const submitted = (await draft(author, "Please review me")).body.data.post;
        assert.equal((await move(author, submitted.id, { to: "pending_review" })).status, 200);

        for (const reviewer of [editor1, editor2]) {
            const found = (await inbox(reviewer)).body.data.notifications.find((n) => n.post?.id === submitted.id);
            assert.equal(found.type, "post_submitted");
            assert.equal(found.actor.username, author.credentials.userName);
        }
        assert.deepEqual(await types(author), [], "the author is not told about their own submission");
        assert.ok(!(await types(reader1)).includes("post_submitted"), "readers never hear about review requests");

        assert.equal((await move(editor1, submitted.id, { to: "published" })).status, 200);
        const approved = (await inbox(author)).body.data.notifications[0];
        assert.equal(approved.type, "post_published");
        assert.equal(approved.actor.username, editor1.credentials.userName);
        assert.equal(approved.post.id, submitted.id);
    });

    it("tells an author when their story is sent back, with the reason, and again on a second rejection", async () => {
        const sent = (await draft(author, "Needs work")).body.data.post;
        await move(author, sent.id, { to: "pending_review" });
        await move(editor1, sent.id, { to: "rejected", reason: "The second half repeats the first." });
        await move(author, sent.id, { to: "pending_review" });
        await move(editor2, sent.id, { to: "rejected", reason: "Still repeats." });

        const rejected = (await inbox(author)).body.data.notifications.filter((n) => n.type === "post_rejected" && n.post.id === sent.id);

        assert.equal(rejected.length, 2);
        // the reason belongs to the latest decision, so only the newest notification shows it
        assert.deepEqual(rejected.map((n) => n.reason), ["Still repeats.", undefined]);
    });

    it("tells an author when a scheduled story goes live", async () => {
        const later = (await draft(author, "Goes live by itself")).body.data.post;
        await Post.update({ status: "scheduled", scheduledAt: new Date(Date.now() - 60_000) }, { where: { id: later.id } });

        await publishDuePosts();
        const found = (await inbox(author)).body.data.notifications.find((n) => n.post.id === later.id);

        assert.equal(found.type, "post_published");
        assert.equal(found.actor, null);
    });

    it("does not tell an account that is not active", async () => {
        const gone = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(gone, "Theirs")).body.data.post;
        await User.update({ status: "suspended" }, { where: { id: gone.user.id } });

        await comment(reader1, theirs.id, "Anyone there?");
        await settleJobs();

        assert.equal(await Notification.count({ where: { recipientId: gone.user.id } }), 0);
    });

    it("records an event once even if its job runs again", async () => {
        const post = (await publish(editor1, "Retry story")).body.data.post;
        const written = (await comment(reader1, post.id, "Once only")).body.data.comment;
        await settleJobs();

        await handleEvent({ event: "comment_created", commentId: written.id });
        await handleEvent({ event: "comment_created", commentId: written.id });

        assert.equal(await Notification.count({ where: { commentId: written.id } }), 1);
    });

    it("never lets a failing queue fail the request that caused the event", async () => {
        const queue = getQueue();
        const original = queue.add;
        queue.add = async () => {
            throw new Error("Redis is away");
        };
        try {
            const response = await comment(reader1, story.id, "Posted while the queue is down");
            assert.equal(response.status, 201);
            assert.equal((await follow(reader2, reader1.credentials.userName)).status, 200);
        } finally {
            queue.add = original;
        }
    });

    it("puts only ids and event names in jobs, never text", async () => {
        const queue = getQueue();
        const original = queue.add;
        const jobs = [];
        queue.add = async (name, data, options) => {
            jobs.push({ name, data });
            return original.call(queue, name, data, options);
        };
        try {
            await comment(reader1, story.id, "SECRET-WORDS in a comment");
            await settleJobs();
        } finally {
            queue.add = original;
        }

        assert.ok(jobs.length >= 1);
        for (const { data } of jobs) {
            assert.ok(!JSON.stringify(data).includes("SECRET-WORDS"));
            for (const [key, value] of Object.entries(data)) {
                assert.ok(key === "event" || typeof value === "number", `${key} should be an id or a number`);
            }
        }
    });
});

describe("notifications: the inbox", () => {
    let editor;
    let reader;
    let other;
    let post;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        other = await registerAndLogin({ role: "user" });
        post = (await publish(editor, "The inbox story")).body.data.post;
        for (let i = 1; i <= 5; i += 1) await comment(reader, post.id, `comment ${i}`);
        await settleJobs();
    });

    const mine = async () => (await inbox(editor)).body.data.notifications;

    it("needs a login everywhere", async () => {
        for (const [method, path] of [["get", ""], ["get", "/unread-count"], ["post", "/read"], ["get", "/preferences"], ["put", "/preferences"], ["delete", "/1"]]) {
            assert.equal((await request(app)[method](`/api/notifications${path}`)).status, 401, `${method} ${path}`);
        }
    });

    it("lists newest first, in pages, with the unread count", async () => {
        const first = await inbox(editor, "?limit=2");

        assert.deepEqual(first.body.data.notifications.map((n) => n.comment.excerpt), ["comment 5", "comment 4"]);
        assert.deepEqual(first.body.meta.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });
        assert.equal(first.body.meta.unreadCount, 5);
        assert.deepEqual((await inbox(editor, "?limit=2&page=3")).body.data.notifications.map((n) => n.comment.excerpt), ["comment 1"]);
        assert.equal((await request(app).get("/api/notifications/unread-count").set(bearer(editor.token))).body.data.unreadCount, 5);
    });

    it("marks some as read, ignores ids that are not yours, then marks everything", async () => {
        const ids = (await mine()).map((n) => n.id);

        const foreign = await request(app).post("/api/notifications/read").set(bearer(other.token)).send({ ids });
        assert.equal(foreign.body.data.updated, 0, "another person's notifications are not matched");
        assert.equal((await inbox(editor)).body.meta.unreadCount, 5);

        const some = await request(app).post("/api/notifications/read").set(bearer(editor.token)).send({ ids: ids.slice(0, 2) });
        assert.deepEqual([some.body.data.updated, some.body.data.unreadCount], [2, 3]);
        assert.deepEqual((await inbox(editor, "?unread=1")).body.data.notifications.length, 3);

        const all = await request(app).post("/api/notifications/read").set(bearer(editor.token)).send({ all: true });
        assert.deepEqual([all.body.data.updated, all.body.data.unreadCount], [3, 0]);
        assert.equal((await inbox(editor, "?unread=1")).body.data.notifications.length, 0);
        assert.ok((await mine()).every((n) => n.readAt));
    });

    it("validates what to mark", async () => {
        const send = (body) => request(app).post("/api/notifications/read").set(bearer(editor.token)).send(body);

        for (const body of [{}, { ids: [] }, { ids: ["1"] }, { ids: [1.5] }, { ids: [-1] }, { ids: Array.from({ length: 101 }, (_, i) => i + 1) }, { all: false }, { ids: [1], all: true }]) {
            assert.equal((await send(body)).status, 400, JSON.stringify(body).slice(0, 50));
        }
    });

    it("lets you dismiss your own notification and nobody else's", async () => {
        const [target] = await mine();

        assert.equal((await request(app).delete(`/api/notifications/${target.id}`).set(bearer(other.token))).status, 404);
        assert.equal((await request(app).delete(`/api/notifications/${target.id}`).set(bearer(editor.token))).status, 200);
        assert.equal((await request(app).delete(`/api/notifications/${target.id}`).set(bearer(editor.token))).status, 404);
        assert.equal((await request(app).delete("/api/notifications/abc").set(bearer(editor.token))).status, 404);
        assert.equal((await mine()).length, 4);
    });

    it("hides a notification about a story that is no longer public, and shows it again when it is", async () => {
        const before = (await mine()).length;

        await Post.update({ status: "archived" }, { where: { id: post.id } });
        assert.equal((await mine()).length, 0);

        await Post.update({ status: "published" }, { where: { id: post.id } });
        assert.equal((await mine()).length, before);
    });

    it("hides a notification about a comment that was deleted", async () => {
        const [target] = await mine();
        const row = await Notification.findByPk(target.id);

        await request(app).delete(`/api/comments/${row.commentId}`).set(bearer(reader.token));

        assert.ok(!(await mine()).some((n) => n.id === target.id));
    });

    it("keeps showing a rejected story to its own author, who may always see it", async () => {
        const writer = await registerAndLogin({ role: "author" });
        const sent = (await draft(writer, "Private to the author now")).body.data.post;
        await move(writer, sent.id, { to: "pending_review" });
        await move(editor, sent.id, { to: "rejected", reason: "Not yet." });

        const found = (await inbox(writer)).body.data.notifications.find((n) => n.post.id === sent.id);

        assert.equal(found.post.title, "Private to the author now");
        assert.equal(found.reason, "Not yet.");
    });

    it("shows an actor whose account was deleted as 'Deleted user'", async () => {
        const leaver = await registerAndLogin({ role: "user" });
        await follow(leaver, editor.credentials.userName);
        const named = (await inbox(editor)).body.data.notifications.find((n) => n.type === "new_follower" && n.actor.username === leaver.credentials.userName);
        assert.ok(named, "the follow was announced under the person's name");

        await request(app).delete("/api/users/me").set(bearer(leaver.token)).send({ password: leaver.credentials.password });

        const shown = (await mine()).find((n) => n.id === named.id);
        assert.deepEqual({ username: shown.actor.username, deleted: shown.actor.deleted }, { username: "Deleted user", deleted: true });
        assert.ok(!JSON.stringify(shown).includes(leaver.credentials.userName));
    });

    it("removes a person's whole inbox and their choices when their account is deleted", async () => {
        const leaver = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(leaver, "Soon gone")).body.data.post;
        await comment(reader, theirs.id, "Hello");
        await request(app).put("/api/notifications/preferences").set(bearer(leaver.token)).send({ preferences: [{ type: "comment_on_post", inApp: true, email: false }] });
        await settleJobs();
        assert.equal(await Notification.count({ where: { recipientId: leaver.user.id } }), 1);

        await request(app).delete("/api/users/me").set(bearer(leaver.token)).send({ password: leaver.credentials.password });

        assert.equal(await Notification.count({ where: { recipientId: leaver.user.id } }), 0);
        assert.equal(await NotificationPreference.count({ where: { userId: leaver.user.id } }), 0);
    });

    it("costs the same number of queries for a long page as for a short one", async () => {
        const busy = (await publish(editor, "Busy")).body.data.post;
        for (let i = 0; i < 12; i += 1) await comment(other, busy.id, `busy ${i}`);
        await settleJobs();
        const count = async (limit) => {
            let queries = 0;
            const hook = () => {
                queries += 1;
            };
            sequelize.addHook("beforeQuery", hook);
            try {
                assert.equal((await request(app).get(`/api/notifications?limit=${limit}`).set(bearer(editor.token))).status, 200);
            } finally {
                sequelize.removeHook("beforeQuery", hook);
            }
            return queries;
        };

        const small = await count(2);
        const large = await count(10);

        assert.ok(small >= 4, `the counter should see the queries (saw ${small})`);
        assert.equal(small, large, `${small} queries for 2 notifications, ${large} for 10`);
    });
});

describe("notification preferences", () => {
    let editor;
    let reader;
    let commenter;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        commenter = await registerAndLogin({ role: "user" });
    });

    const getPrefs = (who) => request(app).get("/api/notifications/preferences").set(bearer(who.token));
    const putPrefs = (who, preferences) => request(app).put("/api/notifications/preferences").set(bearer(who.token)).send({ preferences });

    it("starts with the defaults, and shows review requests only to editors", async () => {
        const forReader = (await getPrefs(reader)).body.data.preferences;
        const forEditor = (await getPrefs(editor)).body.data.preferences;

        assert.deepEqual(forReader.map((p) => p.type), ["comment_on_post", "comment_reply", "new_follower", "post_published", "post_rejected", "comment_removed", "post_unpublished"]);
        assert.deepEqual(forEditor.map((p) => p.type), ["comment_on_post", "comment_reply", "new_follower", "post_submitted", "post_published", "post_rejected", "comment_removed", "post_unpublished"]);
        const byType = Object.fromEntries(forReader.map((p) => [p.type, p]));
        assert.deepEqual([byType.comment_on_post.inApp, byType.comment_on_post.email], [true, true]);
        assert.deepEqual([byType.new_follower.inApp, byType.new_follower.email], [true, false]);
        assert.ok(forReader.every((p) => typeof p.label === "string" && p.label));
    });

    it("saves choices, which come back on the next read", async () => {
        const saved = await putPrefs(reader, [{ type: "new_follower", inApp: false, email: true }]);

        assert.equal(saved.status, 200);
        const byType = Object.fromEntries(saved.body.data.preferences.map((p) => [p.type, p]));
        assert.deepEqual([byType.new_follower.inApp, byType.new_follower.email], [false, true]);
        assert.deepEqual([byType.comment_reply.inApp, byType.comment_reply.email], [true, true], "kinds that were not sent keep their defaults");
        const again = Object.fromEntries((await getPrefs(reader)).body.data.preferences.map((p) => [p.type, p]));
        assert.equal(again.new_follower.email, true);
    });

    it("validates choices", async () => {
        const bad = [
            [],
            [{ type: "made_up", inApp: true, email: true }],
            [{ type: "new_follower", inApp: "yes", email: true }],
            [{ type: "new_follower", inApp: true }],
            [{ type: "new_follower", inApp: true, email: true }, { type: "new_follower", inApp: false, email: false }],
            [{ type: "post_submitted", inApp: true, email: true }],
        ];
        for (const preferences of bad) assert.equal((await putPrefs(reader, preferences)).status, 400, JSON.stringify(preferences).slice(0, 60));
        assert.equal((await request(app).put("/api/notifications/preferences").set(bearer(reader.token)).send({})).status, 400);
    });

    it("keeps an email-only choice out of the inbox, and an off-off choice out of everything", async () => {
        const quiet = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(quiet, "Quiet story")).body.data.post;
        await putPrefs(quiet, [{ type: "comment_on_post", inApp: false, email: true }]);

        await comment(commenter, theirs.id, "first");
        await settleJobs();
        assert.equal(await Notification.count({ where: { recipientId: quiet.user.id } }), 1, "a row exists for the email");
        assert.equal((await inbox(quiet)).body.data.notifications.length, 0, "but it is not in the inbox");
        assert.equal((await inbox(quiet)).body.meta.unreadCount, 0);

        await putPrefs(quiet, [{ type: "comment_on_post", inApp: false, email: false }]);
        await comment(commenter, theirs.id, "second");
        await settleJobs();
        assert.equal(await Notification.count({ where: { recipientId: quiet.user.id } }), 1, "nothing new when both are off");
    });

    it("leaves a choice out of the inbox when in-app is off and puts new events there when it is on again", async () => {
        const toggler = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(toggler, "Toggle story")).body.data.post;
        await putPrefs(toggler, [{ type: "comment_on_post", inApp: false, email: false }]);
        await comment(commenter, theirs.id, "unseen");
        await putPrefs(toggler, [{ type: "comment_on_post", inApp: true, email: false }]);
        await comment(commenter, theirs.id, "seen");

        assert.deepEqual((await inbox(toggler)).body.data.notifications.map((n) => n.comment.excerpt), ["seen"]);
    });

    it("needs a login", async () => {
        assert.equal((await request(app).get("/api/notifications/preferences")).status, 401);
        assert.equal((await request(app).put("/api/notifications/preferences").send({ preferences: [] })).status, 401);
    });
});
