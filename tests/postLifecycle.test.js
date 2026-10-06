import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Post } from "../database/models/index.js";
import { env } from "../config/env.js";
import { POST_STATUSES } from "../config/posts.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const create = (token, body = {}) =>
    request(app).post("/api/posts").set(bearer(token)).send({ title: "A title", content: "Some content for the post.", ...body });
const move = (token, id, to, extra = {}) => request(app).post(`/api/posts/${id}/status`).set(bearer(token)).send({ to, ...extra });
const read = (token, id) => (token ? request(app).get(`/api/posts/${id}`).set(bearer(token)) : request(app).get(`/api/posts/${id}`));
const inHours = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();

after(closeDatabase);

describe("post lifecycle", () => {
    let author;
    let editor;
    let otherEditor;
    let admin;
    let stranger;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        otherEditor = await registerAndLogin({ role: "editor" });
        admin = await registerAndLogin({ role: "admin" });
        stranger = await registerAndLogin({ role: "author" });
    });
    afterEach(() => {
        env.REQUIRE_POST_REVIEW = true;
    });

    const draftOf = async (owner = author, body = {}) => (await create(owner.token, body)).body.data.post;
    const pendingOf = async (owner = author, body = {}) => {
        const post = await draftOf(owner, body);
        await move(owner.token, post.id, "pending_review");
        return post;
    };

    describe("creating", () => {
        it("makes a draft with a slug, stored excerpt and reading time, and offers the author the right actions", async () => {
            const response = await create(author.token, { title: "How to Build JWT Authentication" });

            assert.equal(response.status, 201);
            const { post } = response.body.data;
            assert.equal(post.status, "draft");
            assert.equal(post.slug, "how-to-build-jwt-authentication");
            assert.equal(post.excerpt, "Some content for the post.");
            assert.equal(post.readingTime, 1);
            assert.equal(post.publishedAt, null);
            assert.equal(post.canEdit, true);
            assert.deepEqual([...post.actions].sort(), ["pending_review", "private"]);
        });

        it("keeps a draft out of the public listing", async () => {
            await draftOf();

            const list = await request(app).get("/api/posts");

            assert.deepEqual(list.body.data.posts, []);
        });

        it("refuses an author who asks to publish immediately, explaining that review is needed", async () => {
            const response = await create(author.token, { status: "published" });

            assert.equal(response.status, 403);
            assert.equal(response.body.error.code, "REVIEW_REQUIRED");
            assert.equal(await Post.count({ where: { title: "A title", status: "published" } }), 0);
        });

        it("lets an editor publish at creation, and stamps the publication time", async () => {
            const response = await create(editor.token, { title: "Straight to print", status: "published" });

            assert.equal(response.status, 201);
            assert.equal(response.body.data.post.status, "published");
            assert.ok(response.body.data.post.publishedAt);
            const audit = await AuditLog.findOne({ where: { action: "post.status_changed", entityId: String(response.body.data.post.id) } });
            assert.deepEqual(audit.metadata, { from: null, to: "published" });
        });

        it("lets an author publish at creation when review is switched off", async () => {
            env.REQUIRE_POST_REVIEW = false;

            const response = await create(author.token, { title: "No review needed", status: "published" });

            assert.equal(response.status, 201);
            assert.equal(response.body.data.post.status, "published");
        });

        it("ignores fields a client must not set (author, dates, reviewer)", async () => {
            const response = await create(author.token, { title: "Sneaky", userId: stranger.user.id, publishedAt: "2020-01-01T00:00:00Z", reviewedBy: admin.user.id, scheduledAt: "2030-01-01T00:00:00Z" });

            const stored = await Post.findByPk(response.body.data.post.id);
            assert.equal(stored.userId, author.user.id);
            assert.equal(stored.publishedAt, null);
            assert.equal(stored.reviewedBy, null);
            assert.equal(stored.scheduledAt, null);
        });
    });

    describe("review workflow", () => {
        it("submit, approve, publish: the full happy path", async () => {
            const post = await draftOf(author, { title: "Going to press" });

            const submitted = await move(author.token, post.id, "pending_review");
            assert.equal(submitted.status, 200);
            assert.equal(submitted.body.data.post.status, "pending_review");
            assert.deepEqual(submitted.body.data.post.actions, ["draft"], "the author can only withdraw");
            assert.equal(submitted.body.data.post.canEdit, false);

            assert.equal((await request(app).get(`/api/posts/slug/${post.slug}`)).status, 404, "not public while in review");

            const approved = await move(editor.token, post.id, "published");
            assert.equal(approved.status, 200);
            assert.equal(approved.body.data.post.status, "published");
            assert.ok(approved.body.data.post.publishedAt);
            assert.equal(approved.body.data.post.reviewedAt !== null, true);

            const stored = await Post.findByPk(post.id);
            assert.equal(stored.reviewedBy, editor.user.id);

            const publicRead = await request(app).get(`/api/posts/slug/${post.slug}`);
            assert.equal(publicRead.status, 200);
            assert.equal(publicRead.body.data.post.title, "Going to press");
            const list = await request(app).get("/api/posts");
            assert.ok(list.body.data.posts.some((p) => p.slug === post.slug));
        });

        it("shows the review queue to editors and admins only, oldest first", async () => {
            await Post.destroy({ where: {} });
            const first = await pendingOf(author, { title: "First in line" });
            await new Promise((resolve) => setTimeout(resolve, 1100));
            const second = await pendingOf(stranger, { title: "Second in line" });
            await draftOf(author, { title: "Still a draft" });

            const queue = await request(app).get("/api/posts/review").set(bearer(editor.token));

            assert.equal(queue.status, 200);
            assert.deepEqual(queue.body.data.posts.map((p) => p.id), [first.id, second.id]);
            assert.ok(!("content" in queue.body.data.posts[0]));
            assert.equal((await request(app).get("/api/posts/review").set(bearer(admin.token))).status, 200);
            assert.equal((await request(app).get("/api/posts/review").set(bearer(author.token))).status, 403);
            assert.equal((await request(app).get("/api/posts/review")).status, 401);
        });

        it("rejecting needs a reason, which the author sees but the public does not", async () => {
            const post = await pendingOf(author);

            assert.equal((await move(editor.token, post.id, "rejected")).status, 400);
            assert.equal((await move(editor.token, post.id, "rejected", { reason: "   " })).status, 400);

            const rejected = await move(editor.token, post.id, "rejected", { reason: "Please add sources." });
            assert.equal(rejected.status, 200);
            assert.equal(rejected.body.data.post.status, "rejected");
            assert.equal(rejected.body.data.post.rejectionReason, "Please add sources.");

            const ownerView = await read(author.token, post.id);
            assert.equal(ownerView.body.data.post.rejectionReason, "Please add sources.");
            assert.equal((await read(null, post.id)).status, 404);
            assert.equal((await read(stranger.token, post.id)).status, 404);
        });

        it("lets the author fix a rejected post, resubmit it, and clears the old verdict", async () => {
            const post = await pendingOf(author);
            await move(editor.token, post.id, "rejected", { reason: "Too short." });

            const edit = await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ content: "A much longer and better post body." });
            assert.equal(edit.status, 200, "rejected posts are editable");

            const resubmitted = await move(author.token, post.id, "pending_review");
            assert.equal(resubmitted.status, 200);
            assert.equal(resubmitted.body.data.post.rejectionReason, null);
            assert.equal((await Post.findByPk(post.id)).reviewedBy, null);
        });

        it("locks a post while it waits for review, until the author withdraws it", async () => {
            const post = await pendingOf(author);

            const locked = await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ title: "Changed under the reviewer" });
            assert.equal(locked.status, 409);
            assert.equal(locked.body.error.code, "POST_LOCKED");

            assert.equal((await move(author.token, post.id, "draft")).status, 200);
            assert.equal((await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ title: "Now fine" })).status, 200);
        });

        it("will not let authors, strangers or anonymous visitors review", async () => {
            const post = await pendingOf(author);

            assert.equal((await move(author.token, post.id, "published")).status, 403, "an author cannot approve their own post");
            assert.equal((await move(stranger.token, post.id, "published")).status, 404, "another author cannot even see it");
            assert.equal((await request(app).post(`/api/posts/${post.id}/status`).send({ to: "published" })).status, 401);
            assert.equal((await Post.findByPk(post.id)).status, "pending_review");
        });

        it("will not let an editor approve their own post, but another editor can", async () => {
            const post = await draftOf(editor);
            await move(editor.token, post.id, "pending_review");

            const self = await move(editor.token, post.id, "published");
            assert.equal(self.status, 403);

            const other = await move(otherEditor.token, post.id, "published");
            assert.equal(other.status, 200);
        });

        it("two editors approving at the same moment: exactly one wins", async () => {
            const post = await pendingOf(author);

            const results = await Promise.all([move(editor.token, post.id, "published"), move(otherEditor.token, post.id, "published")]);

            const statuses = results.map((r) => r.status).sort();
            assert.deepEqual(statuses, [200, 409]);
            assert.equal(results.find((r) => r.status === 409).body.error.code, "INVALID_TRANSITION");
        });

        it("an approval racing the author's withdrawal never publishes a withdrawn post", async () => {
            const post = await pendingOf(author);

            const [withdrawn, approved] = await Promise.all([move(author.token, post.id, "draft"), move(editor.token, post.id, "published")]);

            const final = (await Post.findByPk(post.id)).status;
            assert.ok([withdrawn.status, approved.status].includes(200));
            // whichever got there first decides; the loser is refused instead of overwriting it
            if (final === "draft") assert.notEqual(approved.status, 200);
            else assert.notEqual(withdrawn.status, 200);
        });

        it("records every decision in the audit log with from, to and reason", async () => {
            const post = await pendingOf(author);
            await move(editor.token, post.id, "rejected", { reason: "Needs work." });

            const entries = await AuditLog.findAll({ where: { action: "post.status_changed", entityId: String(post.id) }, order: [["id", "ASC"]] });

            assert.deepEqual(entries.map((e) => [e.metadata.from, e.metadata.to]), [["draft", "pending_review"], ["pending_review", "rejected"]]);
            assert.equal(entries[1].actorId, editor.user.id);
            assert.equal(entries[1].metadata.reason, "Needs work.");
            assert.equal(entries[1].metadata.revision, 1);
        });
    });

    describe("direct publishing, unpublishing and archiving", () => {
        it("lets an editor publish a post from their own draft, and keeps the first publication time forever", async () => {
            const post = await draftOf(editor, { title: "Evergreen" });

            const first = await move(editor.token, post.id, "published");
            const stamp = first.body.data.post.publishedAt;
            await move(editor.token, post.id, "draft");
            await new Promise((resolve) => setTimeout(resolve, 1100));
            const again = await move(editor.token, post.id, "published");

            assert.equal(again.body.data.post.publishedAt, stamp);
        });

        it("lets the author unpublish and archive their own post, which hides it from the public", async () => {
            const post = await draftOf(editor, { title: "Short lived" });
            await move(editor.token, post.id, "published");

            assert.equal((await move(editor.token, post.id, "archived")).status, 200);
            assert.equal((await read(null, post.id)).status, 404);
            assert.equal((await read(editor.token, post.id)).status, 200, "the author still sees it");
            assert.equal((await read(otherEditor.token, post.id)).status, 200, "editors can see archived posts");
            assert.equal((await read(stranger.token, post.id)).status, 404);

            assert.equal((await move(editor.token, post.id, "draft")).status, 200, "unarchiving goes back to draft");
        });

        it("lets an editor pull someone else's published post from public view", async () => {
            const post = await draftOf(editor, { title: "Questionable" });
            await move(editor.token, post.id, "published");

            assert.equal((await move(otherEditor.token, post.id, "archived")).status, 400, "taking down someone else's story needs a reason");
            const pulled = await move(otherEditor.token, post.id, "archived", { reason: "Does not meet our standards." });

            assert.equal(pulled.status, 200);
            assert.equal((await read(null, post.id)).status, 404);
            const audit = await AuditLog.findOne({ where: { action: "post.status_changed", entityId: String(post.id), actorId: otherEditor.user.id } });
            assert.deepEqual([audit.metadata.to, audit.metadata.reason], ["archived", "Does not meet our standards."]);
        });

        it("does not let an author unpublish someone else's post", async () => {
            const post = await draftOf(editor);
            await move(editor.token, post.id, "published");

            assert.equal((await move(stranger.token, post.id, "archived")).status, 403);
        });

        it("keeps a private post visible to its owner only, even from editors", async () => {
            const post = await draftOf(author, { title: "My notes" });
            assert.equal((await move(author.token, post.id, "private")).status, 200);

            assert.equal((await read(author.token, post.id)).status, 200);
            for (const viewer of [null, stranger, editor, admin]) {
                assert.equal((await read(viewer?.token, post.id)).status, 404);
            }
            assert.equal((await move(author.token, post.id, "draft")).status, 200);
        });

        it("lets an author publish and schedule directly when review is switched off", async () => {
            env.REQUIRE_POST_REVIEW = false;
            const post = await draftOf(author, { title: "Trusted author" });

            assert.equal((await move(author.token, post.id, "published")).status, 200);
            assert.equal((await move(author.token, post.id, "draft")).status, 200);
            assert.equal((await move(author.token, post.id, "scheduled", { publishAt: inHours(2) })).status, 200);
        });

        it("explains REVIEW_REQUIRED when an author tries to skip review", async () => {
            const post = await draftOf(author);

            const published = await move(author.token, post.id, "published");
            const scheduled = await move(author.token, post.id, "scheduled", { publishAt: inHours(2) });

            for (const response of [published, scheduled]) {
                assert.equal(response.status, 403);
                assert.equal(response.body.error.code, "REVIEW_REQUIRED");
            }
        });
    });

    describe("scheduling", () => {
        it("lets an editor approve a post for a future time: it stays hidden until then", async () => {
            const post = await pendingOf(author, { title: "Embargoed" });
            const when = inHours(3);

            const response = await move(editor.token, post.id, "scheduled", { publishAt: when });

            assert.equal(response.status, 200);
            assert.equal(response.body.data.post.status, "scheduled");
            // the database keeps whole seconds
            assert.ok(Math.abs(new Date(response.body.data.post.scheduledAt).getTime() - new Date(when).getTime()) < 1000);
            assert.equal((await read(null, post.id)).status, 404);
            assert.equal((await request(app).get("/api/posts")).body.data.posts.some((p) => p.id === post.id), false);
            assert.equal((await read(author.token, post.id)).status, 200, "the author can see it");
            assert.equal((await Post.findByPk(post.id)).reviewedBy, editor.user.id);
        });

        it("validates the schedule", async () => {
            const post = await draftOf(editor);

            const missing = await move(editor.token, post.id, "scheduled");
            const past = await move(editor.token, post.id, "scheduled", { publishAt: inHours(-1) });
            const tooSoon = await move(editor.token, post.id, "scheduled", { publishAt: new Date(Date.now() + 10_000).toISOString() });
            const tooFar = await move(editor.token, post.id, "scheduled", { publishAt: inHours(24 * 400) });
            const garbage = await move(editor.token, post.id, "scheduled", { publishAt: "tomorrow" });
            const wrongStatus = await move(editor.token, post.id, "published", { publishAt: inHours(2) });

            for (const response of [missing, past, tooSoon, tooFar, garbage, wrongStatus]) {
                assert.equal(response.status, 400);
            }
            assert.equal((await Post.findByPk(post.id)).status, "draft");
        });

        it("can be cancelled by the author or reshuffled by an editor", async () => {
            const post = await draftOf(editor);
            await move(editor.token, post.id, "scheduled", { publishAt: inHours(5) });

            const later = await move(editor.token, post.id, "scheduled", { publishAt: inHours(8) });
            assert.equal(later.status, 200);

            const cancelled = await move(editor.token, post.id, "draft");
            assert.equal(cancelled.status, 200);
            assert.equal((await Post.findByPk(post.id)).scheduledAt, null);
        });

        it("locks a scheduled post against edits", async () => {
            const post = await draftOf(editor);
            await move(editor.token, post.id, "scheduled", { publishAt: inHours(5) });

            const edit = await request(app).patch(`/api/posts/${post.id}`).set(bearer(editor.token)).send({ title: "Late change" });

            assert.equal(edit.status, 409);
            assert.equal(edit.body.error.code, "POST_LOCKED");
        });
    });

    describe("what each viewer can see", () => {
        // each status, then who may read it by id and by slug
        const expectations = {
            draft: { anonymous: false, owner: true, stranger: false, editor: false, admin: false },
            pending_review: { anonymous: false, owner: true, stranger: false, editor: true, admin: true },
            scheduled: { anonymous: false, owner: true, stranger: false, editor: true, admin: true },
            published: { anonymous: true, owner: true, stranger: true, editor: true, admin: true },
            rejected: { anonymous: false, owner: true, stranger: false, editor: true, admin: true },
            archived: { anonymous: false, owner: true, stranger: false, editor: true, admin: true },
            private: { anonymous: false, owner: true, stranger: false, editor: false, admin: false },
        };

        for (const status of POST_STATUSES) {
            it(`${status}: visible to exactly the right people, by id and by slug`, async () => {
                const post = await draftOf(author, { title: `Matrix ${status}` });
                await Post.update({ status, publishedAt: status === "published" ? new Date() : null }, { where: { id: post.id } });
                const viewers = { anonymous: null, owner: author, stranger, editor, admin };

                for (const [name, viewer] of Object.entries(viewers)) {
                    const byId = viewer ? await read(viewer.token, post.id) : await read(null, post.id);
                    const bySlug = viewer
                        ? await request(app).get(`/api/posts/slug/${post.slug}`).set(bearer(viewer.token))
                        : await request(app).get(`/api/posts/slug/${post.slug}`);
                    const expected = expectations[status][name] ? 200 : 404;
                    assert.equal(byId.status, expected, `${name} reading a ${status} post by id`);
                    assert.equal(bySlug.status, expected, `${name} reading a ${status} post by slug`);
                }
            });
        }

        it("answers a hidden post and a missing one identically", async () => {
            const hidden = await draftOf(author, { title: "Hidden one" });

            const a = await request(app).get(`/api/posts/${hidden.id}`);
            const b = await request(app).get("/api/posts/999999");
            const c = await request(app).get(`/api/posts/slug/${hidden.slug}`);
            const d = await request(app).get("/api/posts/slug/no-such-post");

            assert.deepEqual(a.body, b.body);
            assert.deepEqual(c.body, d.body);
        });

        it("tells the owner's dashboard about every status, with a status filter", async () => {
            await Post.destroy({ where: {} });
            const a = await draftOf(author, { title: "Draft one" });
            const b = await pendingOf(author, { title: "Pending one" });

            const all = await request(app).get("/api/posts/mine").set(bearer(author.token));
            const pending = await request(app).get("/api/posts/mine?status=pending_review").set(bearer(author.token));
            const others = await request(app).get("/api/posts/mine").set(bearer(stranger.token));

            assert.deepEqual(all.body.data.posts.map((p) => p.id).sort(), [a.id, b.id].sort());
            assert.deepEqual(pending.body.data.posts.map((p) => p.id), [b.id]);
            assert.deepEqual(others.body.data.posts, []);
            assert.equal((await request(app).get("/api/posts/mine?status=bogus").set(bearer(author.token))).status, 400);
            assert.equal((await request(app).get("/api/posts/mine")).status, 401);
        });

        it("lists published posts newest-published first, without their bodies", async () => {
            await Post.destroy({ where: {} });
            const older = await draftOf(editor, { title: "Older story" });
            const newer = await draftOf(editor, { title: "Newer story" });
            await Post.update({ status: "published", publishedAt: new Date("2026-01-01T00:00:00Z") }, { where: { id: newer.id } });
            await Post.update({ status: "published", publishedAt: new Date("2025-06-01T00:00:00Z") }, { where: { id: older.id } });

            const list = await request(app).get("/api/posts");

            assert.deepEqual(list.body.data.posts.map((p) => p.title), ["Newer story", "Older story"]);
            assert.ok(list.body.data.posts.every((p) => !("content" in p) && p.slug && p.publishedAt));
        });
    });

    describe("editing", () => {
        it("cannot change status, author or dates through a content edit", async () => {
            const post = await draftOf(author, { title: "Plain" });

            const response = await request(app)
                .patch(`/api/posts/${post.id}`)
                .set(bearer(author.token))
                .send({ title: "Edited", status: "published", userId: stranger.user.id, publishedAt: "2020-01-01T00:00:00Z", reviewedBy: admin.user.id });

            assert.equal(response.status, 200);
            const stored = await Post.findByPk(post.id);
            assert.equal(stored.status, "draft");
            assert.equal(stored.userId, author.user.id);
            assert.equal(stored.publishedAt, null);
            assert.equal(stored.reviewedBy, null);

            const onlyStatus = await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ status: "published" });
            assert.equal(onlyStatus.status, 400);
        });

        it("lets an author edit their published post live; editors cannot edit it", async () => {
            const post = await draftOf(editor, { title: "Live" });
            await move(editor.token, post.id, "published");

            const own = await request(app).patch(`/api/posts/${post.id}`).set(bearer(editor.token)).send({ content: "Fixed a typo." });
            const other = await request(app).patch(`/api/posts/${post.id}`).set(bearer(otherEditor.token)).send({ content: "Defaced." });

            assert.equal(own.status, 200);
            assert.equal(other.status, 403);
            assert.equal((await read(null, post.id)).body.data.post.content, "<p>Fixed a typo.</p>");
        });

        it("refuses unknown ids and statuses cleanly", async () => {
            const post = await draftOf(author);

            assert.equal((await move(author.token, "abc", "draft")).status, 404);
            assert.equal((await move(author.token, 999999, "draft")).status, 404);
            assert.equal((await move(author.token, post.id, "deleted")).status, 400);
            assert.equal((await move(author.token, post.id, "published")).status, 403);
            assert.equal((await move(author.token, post.id, "draft")).status, 409, "a draft cannot move to draft");
        });
    });
});
