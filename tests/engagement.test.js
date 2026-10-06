import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs } from "./helpers.js";
import { Bookmark, Comment, Follow, Post, PostLike, User } from "../database/models/index.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const publish = (editor, title = "A story") =>
    request(app).post("/api/posts").set(bearer(editor.token)).send({ title, content: "<p>Some words to read.</p>", status: "published" });
const put = (path, token) => request(app).put(path).set(token ? bearer(token) : {});
const del = (path, token) => request(app).delete(path).set(token ? bearer(token) : {});
const get = (path, token) => request(app).get(path).set(token ? bearer(token) : {});
const nameOf = (account) => account.credentials.userName;

after(closeDatabase);

describe("likes", () => {
    let editor;
    let ann;
    let bob;
    let post;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        ann = await registerAndLogin({ role: "user" });
        bob = await registerAndLogin({ role: "user" });
        post = (await publish(editor)).body.data.post;
    });

    it("liking is idempotent and counts each person once", async () => {
        const first = await put(`/api/posts/${post.id}/like`, ann.token);
        const again = await put(`/api/posts/${post.id}/like`, ann.token);
        const second = await put(`/api/posts/${post.id}/like`, bob.token);

        assert.deepEqual(first.body.data, { liked: true, likeCount: 1 });
        assert.deepEqual(again.body.data, { liked: true, likeCount: 1 });
        assert.deepEqual(second.body.data, { liked: true, likeCount: 2 });
        assert.equal(await PostLike.count({ where: { postId: post.id } }), 2);
    });

    it("unliking is idempotent too", async () => {
        const gone = await del(`/api/posts/${post.id}/like`, bob.token);
        const again = await del(`/api/posts/${post.id}/like`, bob.token);

        assert.deepEqual(gone.body.data, { liked: false, likeCount: 1 });
        assert.deepEqual(again.body.data, { liked: false, likeCount: 1 });
    });

    it("needs a login, and answers 404 for posts that are missing, not numbers, or not published", async () => {
        const draft = (await request(app).post("/api/posts").set(bearer(editor.token)).send({ title: "Draft", content: "<p>x</p>" })).body.data.post;

        assert.equal((await put(`/api/posts/${post.id}/like`)).status, 401);
        for (const id of [draft.id, 999999, "abc"]) {
            assert.equal((await put(`/api/posts/${id}/like`, ann.token)).status, 404, String(id));
            assert.equal((await del(`/api/posts/${id}/like`, ann.token)).status, 404, String(id));
        }
        assert.equal((await put(`/api/posts/${draft.id}/like`, editor.token)).status, 404, "not even the author likes a draft");
    });

    it("shows the count to everyone and what you did only to you", async () => {
        const anonymous = (await get(`/api/posts/${post.id}`)).body.data.post;
        const annView = (await get(`/api/posts/${post.id}`, ann.token)).body.data.post;
        const bobView = (await get(`/api/posts/${post.id}`, bob.token)).body.data.post;

        assert.equal(anonymous.likeCount, 1);
        assert.ok(!("liked" in anonymous) && !("bookmarked" in anonymous), "nothing personal for an anonymous visitor");
        assert.deepEqual([annView.liked, annView.bookmarked], [true, false]);
        assert.equal(bobView.liked, false);

        const bySlug = (await get(`/api/posts/slug/${post.slug}`, ann.token)).body.data.post;
        assert.equal(bySlug.liked, true);
        const listed = (await get("/api/posts?limit=50")).body.data.posts.find((p) => p.id === post.id);
        assert.equal(listed.likeCount, 1);
        assert.ok(!("liked" in listed), "lists carry counts only");
    });

    it("liking is not possible once the post is pulled, and the likes are remembered if it returns", async () => {
        const target = (await publish(editor, "Pulled and back")).body.data.post;
        await put(`/api/posts/${target.id}/like`, ann.token);

        await Post.update({ status: "archived" }, { where: { id: target.id } });
        assert.equal((await put(`/api/posts/${target.id}/like`, bob.token)).status, 404);

        await Post.update({ status: "published" }, { where: { id: target.id } });
        assert.equal((await get(`/api/posts/${target.id}`)).body.data.post.likeCount, 1);
    });

    it("never reveals who liked a post", async () => {
        const detail = JSON.stringify((await get(`/api/posts/${post.id}`, bob.token)).body);

        assert.ok(!detail.includes(nameOf(ann)));
    });
});

describe("bookmarks", () => {
    let editor;
    let ann;
    let bob;
    const posts = [];

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        ann = await registerAndLogin({ role: "user" });
        bob = await registerAndLogin({ role: "user" });
        for (const title of ["First", "Second", "Third"]) posts.push((await publish(editor, title)).body.data.post);
    });

    it("saving is idempotent and removing is idempotent", async () => {
        assert.deepEqual((await put(`/api/posts/${posts[0].id}/bookmark`, ann.token)).body.data, { bookmarked: true });
        assert.deepEqual((await put(`/api/posts/${posts[0].id}/bookmark`, ann.token)).body.data, { bookmarked: true });
        assert.equal(await Bookmark.count({ where: { userId: ann.user.id } }), 1);

        assert.deepEqual((await del(`/api/posts/${posts[0].id}/bookmark`, ann.token)).body.data, { bookmarked: false });
        assert.deepEqual((await del(`/api/posts/${posts[0].id}/bookmark`, ann.token)).body.data, { bookmarked: false });
    });

    it("needs a login and a published post", async () => {
        const draft = (await request(app).post("/api/posts").set(bearer(editor.token)).send({ title: "Draft", content: "<p>x</p>" })).body.data.post;

        assert.equal((await put(`/api/posts/${posts[0].id}/bookmark`)).status, 401);
        assert.equal((await get("/api/posts/bookmarks")).status, 401);
        assert.equal((await put(`/api/posts/${draft.id}/bookmark`, ann.token)).status, 404);
        assert.equal((await put("/api/posts/999999/bookmark", ann.token)).status, 404);
    });

    it("lists what you saved, most recently saved first, in pages, and only to you", async () => {
        for (const post of posts) {
            await put(`/api/posts/${post.id}/bookmark`, ann.token);
            await sequelize.query("UPDATE `bookmarks` SET createdAt = DATE_ADD(createdAt, INTERVAL :n SECOND) WHERE userId = :u AND postId = :p", { replacements: { n: posts.indexOf(post), u: ann.user.id, p: post.id } });
        }

        const mine = await get("/api/posts/bookmarks?limit=2", ann.token);
        assert.deepEqual(mine.body.data.posts.map((p) => p.title), ["Third", "Second"]);
        assert.deepEqual(mine.body.meta.pagination, { page: 1, limit: 2, total: 3, totalPages: 2 });
        assert.deepEqual((await get("/api/posts/bookmarks?limit=2&page=2", ann.token)).body.data.posts.map((p) => p.title), ["First"]);
        assert.ok(!("content" in mine.body.data.posts[0]), "previews, not bodies");
        assert.equal(mine.body.data.posts[0].likeCount, 0);

        assert.equal((await get("/api/posts/bookmarks", bob.token)).body.data.posts.length, 0, "someone else's list is theirs alone");
    });

    it("leaves a post out of the list while it is not published, and brings it back with the post", async () => {
        await Post.update({ status: "archived" }, { where: { id: posts[1].id } });
        const hidden = await get("/api/posts/bookmarks", ann.token);
        assert.deepEqual(hidden.body.data.posts.map((p) => p.title), ["Third", "First"]);
        assert.equal(hidden.body.meta.pagination.total, 2);

        await Post.update({ status: "published" }, { where: { id: posts[1].id } });
        assert.equal((await get("/api/posts/bookmarks", ann.token)).body.meta.pagination.total, 3);
    });

    it("tells the signed-in reader whether they saved the post", async () => {
        assert.equal((await get(`/api/posts/${posts[2].id}`, ann.token)).body.data.post.bookmarked, true);
        assert.equal((await get(`/api/posts/${posts[2].id}`, bob.token)).body.data.post.bookmarked, false);
    });
});

describe("follows, profiles and the feed", () => {
    let editor;
    let writer;
    let ann;
    let bob;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        writer = await registerAndLogin({ role: "editor" });
        ann = await registerAndLogin({ role: "user" });
        bob = await registerAndLogin({ role: "user" });
    });

    it("following is idempotent and counts each follower once", async () => {
        const first = await put(`/api/users/${nameOf(writer)}/follow`, ann.token);
        const again = await put(`/api/users/${nameOf(writer)}/follow`, ann.token);
        const second = await put(`/api/users/${nameOf(writer)}/follow`, bob.token);

        assert.deepEqual(first.body.data, { following: true, followerCount: 1 });
        assert.deepEqual(again.body.data, { following: true, followerCount: 1 });
        assert.deepEqual(second.body.data, { following: true, followerCount: 2 });
    });

    it("unfollowing is idempotent", async () => {
        assert.deepEqual((await del(`/api/users/${nameOf(writer)}/follow`, bob.token)).body.data, { following: false, followerCount: 1 });
        assert.deepEqual((await del(`/api/users/${nameOf(writer)}/follow`, bob.token)).body.data, { following: false, followerCount: 1 });
    });

    it("refuses to follow yourself, needs a login, and cannot follow missing, suspended or deleted accounts", async () => {
        const self = await put(`/api/users/${nameOf(ann)}/follow`, ann.token);
        assert.equal(self.status, 400);
        assert.equal(self.body.error.code, "CANNOT_FOLLOW_SELF");

        assert.equal((await put(`/api/users/${nameOf(writer)}/follow`)).status, 401);
        assert.equal((await put("/api/users/nobody_here/follow", ann.token)).status, 404);

        const suspended = await registerAndLogin({ role: "author" });
        await User.update({ status: "suspended" }, { where: { id: suspended.user.id } });
        assert.equal((await put(`/api/users/${nameOf(suspended)}/follow`, ann.token)).status, 404);
        const deleted = await registerAndLogin({ role: "author" });
        await User.update({ status: "deleted" }, { where: { id: deleted.user.id } });
        assert.equal((await put(`/api/users/${nameOf(deleted)}/follow`, ann.token)).status, 404);
        assert.equal(await Follow.count({ where: { followerId: ann.user.id, followingId: [suspended.user.id, deleted.user.id, ann.user.id] } }), 0);
    });

    it("the database itself refuses a self-follow", async () => {
        await assert.rejects(() => Follow.create({ followerId: ann.user.id, followingId: ann.user.id }));
    });

    it("lists followers and following, publicly, with a name and a photo only", async () => {
        await put(`/api/users/${nameOf(writer)}/follow`, bob.token);
        await sequelize.query("UPDATE `follows` SET createdAt = DATE_ADD(createdAt, INTERVAL 5 SECOND) WHERE followerId = :id", { replacements: { id: bob.user.id } });

        const followers = await get(`/api/users/${nameOf(writer)}/followers`);
        assert.deepEqual(followers.body.data.people.map((p) => p.username), [nameOf(bob), nameOf(ann)], "most recent first");
        assert.deepEqual(Object.keys(followers.body.data.people[0]).sort(), ["avatarUrl", "username"]);
        assert.equal(followers.body.meta.pagination.total, 2);

        const following = await get(`/api/users/${nameOf(ann)}/following?limit=1`);
        assert.deepEqual(following.body.data.people.map((p) => p.username), [nameOf(writer)]);
        assert.equal((await get("/api/users/nobody_here/followers")).status, 404);
    });

    it("a profile shows its counts, and whether you follow it, to a signed-in visitor", async () => {
        const anonymous = (await get(`/api/users/${nameOf(writer)}`)).body.data.user;
        assert.deepEqual([anonymous.followerCount, anonymous.followingCount], [2, 0]);
        assert.ok(!("viewer" in anonymous));

        assert.deepEqual((await get(`/api/users/${nameOf(writer)}`, ann.token)).body.data.user.viewer, { following: true });
        const stranger = await registerAndLogin({ role: "user" });
        assert.deepEqual((await get(`/api/users/${nameOf(writer)}`, stranger.token)).body.data.user.viewer, { following: false });
        assert.ok(!("viewer" in (await get(`/api/users/${nameOf(writer)}`, writer.token)).body.data.user), "no follow button on your own profile");
        assert.equal((await get(`/api/users/${nameOf(ann)}`)).body.data.user.followingCount, 1);
    });

    it("the feed holds the published posts of the people you follow, newest first", async () => {
        const older = (await publish(writer, "Older from writer")).body.data.post;
        const newer = (await publish(writer, "Newer from writer")).body.data.post;
        await Post.update({ publishedAt: new Date(Date.now() - 3600_000) }, { where: { id: older.id } });
        await publish(editor, "From someone you do not follow");
        await request(app).post("/api/posts").set(bearer(writer.token)).send({ title: "Writer draft", content: "<p>draft</p>" });

        const feed = await get("/api/posts/feed", ann.token);

        assert.equal(feed.status, 200);
        assert.deepEqual(feed.body.data.posts.map((p) => p.title), ["Newer from writer", "Older from writer"]);
        assert.equal(feed.body.meta.pagination.total, 2);
        assert.equal(feed.body.data.posts[0].id, newer.id);
        assert.equal(feed.body.data.posts[0].commentCount, 0);
    });

    it("the feed is empty when you follow nobody, and needs a login", async () => {
        const loner = await registerAndLogin({ role: "user" });

        assert.equal((await get("/api/posts/feed", loner.token)).body.data.posts.length, 0);
        assert.equal((await get("/api/posts/feed")).status, 401);
    });

    it("stops showing a person's posts when you unfollow them", async () => {
        await del(`/api/users/${nameOf(writer)}/follow`, ann.token);

        assert.equal((await get("/api/posts/feed", ann.token)).body.data.posts.length, 0);
    });
});

describe("account deletion and query counts", () => {
    let editor;
    let leaver;
    let friend;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        leaver = await registerAndLogin({ role: "user" });
        friend = await registerAndLogin({ role: "user" });
    });

    it("deleting an account removes its likes, bookmarks and follows (both ways) and wipes its comments", async () => {
        const post = (await publish(editor, "Left behind")).body.data.post;
        await put(`/api/posts/${post.id}/like`, leaver.token);
        await put(`/api/posts/${post.id}/like`, friend.token);
        await put(`/api/posts/${post.id}/bookmark`, leaver.token);
        await put(`/api/users/${nameOf(friend)}/follow`, leaver.token);
        await put(`/api/users/${nameOf(leaver)}/follow`, friend.token);
        const top = (await request(app).post(`/api/posts/${post.id}/comments`).set(bearer(leaver.token)).send({ body: "my words" })).body.data.comment;
        await request(app).post(`/api/posts/${post.id}/comments`).set(bearer(friend.token)).send({ body: "a reply", parentId: top.id });

        const response = await request(app).delete("/api/users/me").set(bearer(leaver.token)).send({ password: leaver.credentials.password });
        assert.equal(response.status, 200);

        assert.equal(await PostLike.count({ where: { userId: leaver.user.id } }), 0);
        assert.equal(await Bookmark.count({ where: { userId: leaver.user.id } }), 0);
        assert.equal(await Follow.count({ where: { followerId: leaver.user.id } }) + (await Follow.count({ where: { followingId: leaver.user.id } })), 0);
        assert.equal((await get(`/api/posts/${post.id}`)).body.data.post.likeCount, 1, "the friend's like stays");

        const shown = (await get(`/api/posts/${post.id}/comments`)).body.data.comments[0];
        assert.deepEqual({ deleted: shown.deleted, body: shown.body, author: shown.author, replyCount: shown.replyCount }, { deleted: true, body: null, author: null, replyCount: 1 });
        assert.equal((await Comment.findByPk(top.id)).body, null, "the words are gone from the database");
        assert.equal((await get(`/api/users/${nameOf(friend)}`)).body.data.user.followerCount, 0);
    });

    it("the number of queries behind a list does not grow with the number of posts", async () => {
        for (let i = 0; i < 8; i += 1) {
            const post = (await publish(editor, `Listed ${i}`)).body.data.post;
            await put(`/api/posts/${post.id}/like`, friend.token);
            await request(app).post(`/api/posts/${post.id}/comments`).set(bearer(friend.token)).send({ body: "hi" });
        }
        await settleJobs(); // background jobs from the comments above must not be counted
        const countQueries = async (path, token) => {
            let queries = 0;
            const count = () => {
                queries += 1;
            };
            sequelize.addHook("beforeQuery", count);
            try {
                assert.equal((await get(path, token)).status, 200);
            } finally {
                sequelize.removeHook("beforeQuery", count);
            }
            return queries;
        };

        await put(`/api/users/${nameOf(editor)}/follow`, friend.token);
        await settleJobs(); // the follow queues a notification job, which must not run during a measurement
        for (const path of ["/api/posts", "/api/posts/feed", "/api/posts/bookmarks"]) {
            if (path.endsWith("bookmarks")) {
                const all = (await get("/api/posts?limit=50")).body.data.posts;
                for (const post of all) await put(`/api/posts/${post.id}/bookmark`, friend.token);
            }
            const small = await countQueries(`${path}?limit=2`, friend.token);
            const large = await countQueries(`${path}?limit=8`, friend.token);
            assert.ok(small >= 3, `${path}: the counter should see the queries (saw ${small})`);
            assert.equal(small, large, `${path}: ${small} queries for 2 posts, ${large} for 8`);
        }
    });
});
