import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Comment, Post } from "../database/models/index.js";
import { MAX_COMMENTS_PER_HOUR, MAX_COMMENT_LENGTH } from "../config/engagement.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const publish = (editor, title = "A story") =>
    request(app).post("/api/posts").set(bearer(editor.token)).send({ title, content: "<p>Some words to read.</p>", status: "published" });
const comment = (token, postId, body) => request(app).post(`/api/posts/${postId}/comments`).set(bearer(token)).send(body);
const list = (postId, token, query = "") => request(app).get(`/api/posts/${postId}/comments${query}`).set(token ? bearer(token) : {});
const replies = (id, token, query = "") => request(app).get(`/api/comments/${id}/replies${query}`).set(token ? bearer(token) : {});
const edit = (token, id, body) => request(app).patch(`/api/comments/${id}`).set(bearer(token)).send(body);
const remove = (token, id) => request(app).delete(`/api/comments/${id}`).set(bearer(token));

after(closeDatabase);

describe("comments: writing and reading", () => {
    let editor;
    let reader;
    let other;
    let postId;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        other = await registerAndLogin({ role: "user" });
        postId = (await publish(editor)).body.data.post.id;
    });

    it("a reader can comment, and anyone can read it", async () => {
        const created = await comment(reader.token, postId, { body: "  Nicely said.  " });

        assert.equal(created.status, 201);
        const c = created.body.data.comment;
        assert.equal(c.body, "Nicely said.");
        assert.equal(c.parentId, null);
        assert.equal(c.author.username, reader.credentials.userName);
        assert.equal(c.deleted, false);
        assert.equal(c.canEdit, true);
        assert.equal(c.replyCount, 0);

        const anonymous = await list(postId);
        assert.equal(anonymous.status, 200);
        const seen = anonymous.body.data.comments.find((x) => x.id === c.id);
        assert.equal(seen.body, "Nicely said.");
        assert.equal(seen.canEdit, false, "an anonymous visitor can change nothing");
        assert.equal(seen.canDelete, false);
    });

    it("needs a login and a verified email", async () => {
        const unverified = await registerAndLogin({ role: "user", verified: false });

        assert.equal((await request(app).post(`/api/posts/${postId}/comments`).send({ body: "hi" })).status, 401);
        const refused = await comment(unverified.token, postId, { body: "hi" });
        assert.equal(refused.status, 403);
        assert.equal(refused.body.error.code, "EMAIL_NOT_VERIFIED");
    });

    it("validates the text: required, trimmed, at most the limit, no unknown keys honoured", async () => {
        for (const body of [{}, { body: "" }, { body: "   \n  " }, { body: "x".repeat(MAX_COMMENT_LENGTH + 1) }, { body: 5 }, { body: "ok", parentId: "7" }, { body: "ok", parentId: -1 }]) {
            const response = await comment(reader.token, postId, body);
            assert.equal(response.status, 400, JSON.stringify(body).slice(0, 60));
        }
        assert.equal((await comment(reader.token, postId, { body: "x".repeat(MAX_COMMENT_LENGTH) })).status, 201);

        const sneaky = await comment(reader.token, postId, { body: "mine", userId: editor.user.id, postId: 999, createdAt: "2001-01-01", deletedAt: "2001-01-01" });
        assert.equal(sneaky.status, 201);
        assert.equal(sneaky.body.data.comment.author.username, reader.credentials.userName, "the author is the caller, whatever the body says");
        assert.equal(sneaky.body.data.comment.postId, postId);
        assert.equal(sneaky.body.data.comment.deleted, false);
    });

    it("keeps markup as plain text and strips control characters", async () => {
        const hostile = '<script>alert(1)</script> <img src=x onerror=alert(1)> & "quotes"';
        const created = (await comment(reader.token, postId, { body: `${hostile}\u0000‮` })).body.data.comment;

        assert.equal(created.body, hostile, "stored and returned exactly as typed, to be shown as text");
        assert.equal((await comment(reader.token, postId, { body: "\u0000\u0001‮" })).status, 400, "nothing left after cleaning");
    });

    it("answers 404 for posts that are missing, hidden or not numbers", async () => {
        const draft = (await request(app).post("/api/posts").set(bearer(editor.token)).send({ title: "Hidden", content: "<p>draft</p>" })).body.data.post;

        for (const id of [draft.id, 999999, "abc"]) {
            assert.equal((await list(id)).status, 404, `list ${id}`);
            assert.equal((await comment(reader.token, id, { body: "hi" })).status, 404, `write ${id}`);
        }
        assert.equal((await list(draft.id, editor.token)).status, 404, "not even its author sees comments on an unpublished post");
    });

    it("lists top-level comments newest first, in pages", async () => {
        const post = (await publish(editor, "Busy post")).body.data.post;
        for (let i = 1; i <= 7; i += 1) await comment(reader.token, post.id, { body: `comment ${i}` });

        const first = await list(post.id, null, "?limit=3");
        assert.deepEqual(first.body.data.comments.map((c) => c.body), ["comment 7", "comment 6", "comment 5"]);
        assert.deepEqual(first.body.meta.pagination, { page: 1, limit: 3, total: 7, totalPages: 3 });
        const last = await list(post.id, null, "?limit=3&page=3");
        assert.deepEqual(last.body.data.comments.map((c) => c.body), ["comment 1"]);
        assert.equal((await list(post.id, null, "?limit=1000")).body.meta.pagination.limit, 50, "the page size is capped");
    });

    it("allows one level of replies, listed oldest first under their comment", async () => {
        const post = (await publish(editor, "Threads")).body.data.post;
        const top = (await comment(reader.token, post.id, { body: "top" })).body.data.comment;
        const first = (await comment(other.token, post.id, { body: "first reply", parentId: top.id })).body.data.comment;
        await comment(reader.token, post.id, { body: "second reply", parentId: top.id });

        assert.equal(first.parentId, top.id);
        const topLevel = (await list(post.id)).body.data.comments;
        assert.equal(topLevel.length, 1, "replies are not listed at the top level");
        assert.equal(topLevel[0].replyCount, 2);

        const thread = await replies(top.id);
        assert.deepEqual(thread.body.data.comments.map((c) => c.body), ["first reply", "second reply"]);
        assert.equal(thread.body.meta.pagination.total, 2);

        const reply = await comment(reader.token, post.id, { body: "deeper", parentId: first.id });
        assert.equal(reply.status, 400, "no replies to replies");
        assert.equal((await replies(first.id)).status, 404, "a reply has no replies of its own");
    });

    it("refuses a reply to a comment on another post, to a missing comment, or to a deleted one", async () => {
        const a = (await publish(editor, "Post A")).body.data.post;
        const b = (await publish(editor, "Post B")).body.data.post;
        const onA = (await comment(reader.token, a.id, { body: "on A" })).body.data.comment;
        const gone = (await comment(reader.token, a.id, { body: "to be deleted" })).body.data.comment;
        await remove(reader.token, gone.id);

        for (const parentId of [onA.id, 999999, gone.id]) {
            const target = parentId === onA.id ? b.id : a.id;
            const response = await comment(reader.token, target, { body: "reply", parentId });
            assert.equal(response.status, 400, `parent ${parentId} on post ${target}`);
        }
    });

    it("counts the live comments of a post in its detail and in lists", async () => {
        const post = (await publish(editor, "Counted")).body.data.post;
        const top = (await comment(reader.token, post.id, { body: "one" })).body.data.comment;
        await comment(other.token, post.id, { body: "reply", parentId: top.id });
        const doomed = (await comment(other.token, post.id, { body: "two" })).body.data.comment;
        await remove(other.token, doomed.id);

        const detail = await request(app).get(`/api/posts/${post.id}`);
        assert.equal(detail.body.data.post.commentCount, 2, "replies count, deleted comments do not");
        const listed = (await request(app).get("/api/posts?limit=50")).body.data.posts.find((p) => p.id === post.id);
        assert.equal(listed.commentCount, 2);
        assert.equal(listed.likeCount, 0);
    });

    it("limits how many comments one person can write in an hour", async () => {
        const spammer = await registerAndLogin({ role: "user" });
        const post = (await publish(editor, "Spam target")).body.data.post;
        await Comment.bulkCreate(Array.from({ length: MAX_COMMENTS_PER_HOUR }, (_, i) => ({ postId: post.id, userId: spammer.user.id, body: `spam ${i}` })));

        const refused = await comment(spammer.token, post.id, { body: "one too many" });

        assert.equal(refused.status, 429);
        assert.equal((await comment(reader.token, post.id, { body: "someone else is fine" })).status, 201);
    });

    it("a repeated Idempotency-Key creates one comment", async () => {
        const post = (await publish(editor, "Double click")).body.data.post;
        const send = () => request(app).post(`/api/posts/${post.id}/comments`).set(bearer(reader.token)).set("Idempotency-Key", "same-click").send({ body: "once" });

        const [one, two] = [await send(), await send()];

        assert.equal(one.status, 201);
        assert.equal(two.body.data.comment.id, one.body.data.comment.id);
        assert.equal(await Comment.count({ where: { postId: post.id } }), 1);
    });
});

describe("comments: editing and deleting", () => {
    let editor;
    let postAuthor;
    let reader;
    let stranger;
    let post;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        postAuthor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        stranger = await registerAndLogin({ role: "user" });
        post = (await publish(postAuthor, "Moderated")).body.data.post;
    });

    const fresh = async (body = "a comment") => (await comment(reader.token, post.id, { body })).body.data.comment;

    it("the author can edit; the text changes and the comment is marked edited", async () => {
        const c = await fresh("typo");

        const edited = await edit(reader.token, c.id, { body: "  fixed  " });

        assert.equal(edited.status, 200);
        assert.equal(edited.body.data.comment.body, "fixed");
        assert.ok(edited.body.data.comment.editedAt);
    });

    it("saving the same words again is a success that is not marked as an edit", async () => {
        const c = await fresh("steady");

        const again = await edit(reader.token, c.id, { body: "steady" });

        assert.equal(again.status, 200);
        assert.equal(again.body.data.comment.editedAt, null);
    });

    it("nobody else can edit it, not even the post's author or an editor", async () => {
        const c = await fresh();

        for (const who of [stranger, postAuthor, editor]) {
            assert.equal((await edit(who.token, c.id, { body: "hijacked" })).status, 403);
        }
        assert.equal((await request(app).patch(`/api/comments/${c.id}`).send({ body: "x" })).status, 401);
        assert.equal((await list(post.id)).body.data.comments.find((x) => x.id === c.id).body, "a comment");
    });

    it("validates an edit and answers 404 for missing or non-numeric ids", async () => {
        const c = await fresh();

        assert.equal((await edit(reader.token, c.id, { body: "" })).status, 400);
        assert.equal((await edit(reader.token, c.id, { body: "x".repeat(MAX_COMMENT_LENGTH + 1) })).status, 400);
        assert.equal((await edit(reader.token, 999999, { body: "x" })).status, 404);
        assert.equal((await edit(reader.token, "abc", { body: "x" })).status, 404);
    });

    it("the author, the post's author and an editor can delete; a stranger cannot", async () => {
        const mine = await fresh();
        const forPostAuthor = await fresh();
        const forEditor = await fresh();
        const protectedOne = await fresh();

        assert.equal((await remove(stranger.token, protectedOne.id)).status, 403);
        assert.equal((await remove(reader.token, mine.id)).status, 200);
        assert.equal((await remove(postAuthor.token, forPostAuthor.id)).status, 200);
        assert.equal((await remove(editor.token, forEditor.id)).status, 200);

        const ids = (await list(post.id)).body.data.comments.map((c) => c.id);
        assert.ok(!ids.includes(mine.id) && !ids.includes(forPostAuthor.id) && !ids.includes(forEditor.id));
        assert.ok(ids.includes(protectedOne.id));
    });

    it("tells each viewer what they may do (canEdit, canDelete)", async () => {
        const c = await fresh("flags");
        const flags = async (token) => (await list(post.id, token)).body.data.comments.find((x) => x.id === c.id);

        assert.deepEqual([(await flags(reader.token)).canEdit, (await flags(reader.token)).canDelete], [true, true]);
        assert.deepEqual([(await flags(postAuthor.token)).canEdit, (await flags(postAuthor.token)).canDelete], [false, true]);
        assert.deepEqual([(await flags(editor.token)).canEdit, (await flags(editor.token)).canDelete], [false, true]);
        assert.deepEqual([(await flags(stranger.token)).canEdit, (await flags(stranger.token)).canDelete], [false, false]);
    });

    it("audits a deletion by someone other than the author, and not the author's own", async () => {
        const byPostAuthor = await fresh();
        const byEditor = await fresh();
        const own = await fresh();

        await remove(postAuthor.token, byPostAuthor.id);
        await remove(editor.token, byEditor.id);
        await remove(reader.token, own.id);

        const rows = await AuditLog.findAll({ where: { action: "comment.deleted_by_other" } });
        const forComment = (id) => rows.find((row) => row.entityId === String(id));
        assert.equal(forComment(byPostAuthor.id).actorId, postAuthor.user.id);
        assert.equal(forComment(byPostAuthor.id).metadata.as, "post_author");
        assert.equal(forComment(byEditor.id).metadata.as, "moderator");
        assert.equal(forComment(byEditor.id).metadata.authorId, reader.user.id);
        assert.equal(forComment(own.id), undefined);
        assert.ok(!JSON.stringify(rows.map((row) => row.metadata)).includes("steady"), "no comment text in the audit trail");
    });

    it("a deleted comment cannot be deleted or edited again, and its words are gone from the database", async () => {
        const c = await fresh("secret words");
        await remove(reader.token, c.id);

        assert.equal((await remove(reader.token, c.id)).status, 404);
        assert.equal((await edit(reader.token, c.id, { body: "back" })).status, 404);
        const row = await Comment.findByPk(c.id);
        assert.equal(row.body, null);
        assert.ok(row.deletedAt);
    });

    it("a deleted comment with replies stays as a placeholder and keeps its thread", async () => {
        const top = await fresh("parent");
        const reply = (await comment(stranger.token, post.id, { body: "child", parentId: top.id })).body.data.comment;

        await remove(reader.token, top.id);

        const shown = (await list(post.id)).body.data.comments.find((c) => c.id === top.id);
        assert.deepEqual({ deleted: shown.deleted, body: shown.body, author: shown.author, replyCount: shown.replyCount }, { deleted: true, body: null, author: null, replyCount: 1 });
        assert.equal(shown.canDelete, false);
        assert.deepEqual((await replies(top.id)).body.data.comments.map((c) => c.body), ["child"]);

        // once the last reply goes too, the placeholder has nothing left to hold up
        await remove(stranger.token, reply.id);
        assert.ok(!(await list(post.id)).body.data.comments.some((c) => c.id === top.id));
        assert.equal((await comment(reader.token, post.id, { body: "late", parentId: top.id })).status, 400);
    });

    it("comments vanish while the post is not published and come back when it is", async () => {
        const target = (await publish(postAuthor, "Comes and goes")).body.data.post;
        const c = (await comment(reader.token, target.id, { body: "still here" })).body.data.comment;

        await Post.update({ status: "archived" }, { where: { id: target.id } });
        for (const response of [await list(target.id), await replies(c.id), await edit(reader.token, c.id, { body: "x" }), await remove(reader.token, c.id), await comment(reader.token, target.id, { body: "y" })]) {
            assert.equal(response.status, 404);
        }

        await Post.update({ status: "published" }, { where: { id: target.id } });
        assert.equal((await list(target.id)).body.data.comments[0].body, "still here");
    });

    it("deleting the post removes its comments", async () => {
        const target = (await publish(postAuthor, "Short lived")).body.data.post;
        await comment(reader.token, target.id, { body: "bye" });

        assert.equal((await request(app).delete(`/api/posts/${target.id}`).set(bearer(postAuthor.token))).status, 200);

        assert.equal(await Comment.count({ where: { postId: target.id } }), 0);
    });
});
