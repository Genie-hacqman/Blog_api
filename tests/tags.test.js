import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Category, Post, PostTag, Tag } from "../database/models/index.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const createPost = (token, body = {}) =>
    request(app).post("/api/posts").set(bearer(token)).send({ title: "A post", content: "Some content for the post.", ...body });
const editPost = (token, id, body) => request(app).patch(`/api/posts/${id}`).set(bearer(token)).send(body);
const move = (token, id, to, extra = {}) => request(app).post(`/api/posts/${id}/status`).set(bearer(token)).send({ to, ...extra });
const tagSlugs = (post) => post.tags.map((tag) => tag.slug);

after(closeDatabase);

describe("tags on posts", () => {
    let author;
    let editor;
    let stranger;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        stranger = await registerAndLogin({ role: "author" });
    });

    it("are created as the author writes, merged when they differ only in case or spacing, and shown alphabetically", async () => {
        const response = await createPost(author.token, { tags: ["React", " react ", "REACT", "Node  JS"] });

        assert.equal(response.status, 201);
        assert.deepEqual(response.body.data.post.tags, [
            { name: "Node JS", slug: "node-js" },
            { name: "React", slug: "react" },
        ]);
        assert.equal(await Tag.count(), 2);
    });

    it("reuse an existing tag instead of making a second one", async () => {
        const before = await Tag.findOne({ where: { slug: "react" } });

        const second = await createPost(author.token, { title: "Another", tags: ["react"] });

        assert.equal(second.body.data.post.tags[0].name, "React", "the first spelling is kept");
        assert.equal((await Tag.findOne({ where: { slug: "react" } })).id, before.id);
        assert.equal(await Tag.count({ where: { slug: "react" } }), 1);
    });

    it("are limited to five, and each name is checked", async () => {
        const tooMany = await createPost(author.token, { tags: ["one", "two", "three", "four", "five", "six"] });
        assert.equal(tooMany.status, 400);
        assert.match(tooMany.body.error.message, /at most 5 tags/);
        assert.equal((await createPost(author.token, { tags: ["one", "two", "three", "four", "five"] })).status, 201);

        const invalid = [["a"], ["x".repeat(31)], ["c++"], ["bad!"], ["日本語"], ["under_score"], ["-lead"], [42], "react", { 0: "x" }, [null]];
        for (const tags of invalid) {
            const response = await createPost(author.token, { title: `Invalid ${JSON.stringify(tags).slice(0, 20)}`, tags });
            assert.equal(response.status, 400, `${JSON.stringify(tags)} must be rejected`);
        }
        assert.equal(await Tag.count({ where: { slug: ["a", "c", "bad"] } }), 0, "a rejected request creates no tags");
    });

    it("are replaced as a set when a post is edited, and an empty list removes them all", async () => {
        const post = (await createPost(author.token, { title: "Swap", tags: ["alpha", "beta"] })).body.data.post;

        const swapped = await editPost(author.token, post.id, { tags: ["beta", "gamma"] });
        assert.deepEqual(tagSlugs(swapped.body.data.post), ["beta", "gamma"]);

        const cleared = await editPost(author.token, post.id, { tags: [] });
        assert.deepEqual(cleared.body.data.post.tags, []);
        assert.equal(await PostTag.count({ where: { postId: post.id } }), 0);

        const untouched = await editPost(author.token, post.id, { title: "Swap again" });
        assert.deepEqual(untouched.body.data.post.tags, [], "editing other fields leaves tags alone");
    });

    it("one new tag used by several posts at once is still a single tag", async () => {
        const responses = await Promise.all(
            Array.from({ length: 6 }, (_, i) => createPost(author.token, { title: `Racing ${i}`, tags: ["Fresh Topic"] })),
        );

        assert.ok(responses.every((response) => response.status === 201), JSON.stringify(responses.map((r) => r.status)));
        assert.equal(await Tag.count({ where: { slug: "fresh-topic" } }), 1);
        const tag = await Tag.findOne({ where: { slug: "fresh-topic" } });
        assert.equal(await PostTag.count({ where: { tagId: tag.id } }), 6);
    });

    it("cannot be changed by someone else, or while the post waits for review", async () => {
        const post = (await createPost(author.token, { title: "Locked", tags: ["keep"] })).body.data.post;

        assert.equal((await editPost(stranger.token, post.id, { tags: ["steal"] })).status, 404, "another author cannot see the draft");
        await move(author.token, post.id, "pending_review");
        const locked = await editPost(author.token, post.id, { tags: ["too-late"] });
        assert.equal(locked.status, 409);
        assert.equal(locked.body.error.code, "POST_LOCKED");
        assert.equal(await Tag.count({ where: { slug: "too-late" } }), 0);
        assert.deepEqual(tagSlugs((await request(app).get(`/api/posts/${post.id}`).set(bearer(author.token))).body.data.post), ["keep"]);
    });

    it("go with the post: previews list them, and deleting the post removes the links but not the tag", async () => {
        const post = (await createPost(editor.token, { title: "Tagged and live", tags: ["travel", "food"], status: "published" })).body.data.post;

        const list = await request(app).get("/api/posts");
        const preview = list.body.data.posts.find((p) => p.id === post.id);
        assert.deepEqual(tagSlugs(preview), ["food", "travel"]);

        await request(app).delete(`/api/posts/${post.id}`).set(bearer(editor.token));
        assert.equal(await PostTag.count({ where: { postId: post.id } }), 0);
        assert.ok(await Tag.findOne({ where: { slug: "travel" } }));
    });
});

describe("browsing tags", () => {
    let editor;
    let author;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        const publish = (title, tags, extra = {}) => createPost(editor.token, { title, tags, status: "published", ...extra });
        await publish("One", ["react", "javascript"]);
        await publish("Two", ["react", "css"]);
        await publish("Three", ["react", "javascript"]);
        await createPost(author.token, { title: "Hidden draft", tags: ["secret-topic", "react"] });
        const scheduled = (await createPost(editor.token, { title: "Later", tags: ["future-topic"] })).body.data.post;
        await Post.update({ status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) }, { where: { id: scheduled.id } });
    });

    it("lists popular tags first, and only tags that a published post uses", async () => {
        const response = await request(app).get("/api/tags");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data.tags.map((t) => [t.slug, t.postCount]), [["react", 3], ["javascript", 2], ["css", 1]]);
    });

    it("narrows by prefix for autocomplete, treating % and _ as ordinary characters", async () => {
        const some = await request(app).get("/api/tags?q=ja");
        assert.deepEqual(some.body.data.tags.map((t) => t.slug), ["javascript"]);

        for (const wildcard of ["%", "_", "r%", "%%%", "\\"]) {
            const response = await request(app).get(`/api/tags?q=${encodeURIComponent(wildcard)}`);
            assert.equal(response.status, 200);
            assert.deepEqual(response.body.data.tags, [], `${wildcard} must not act as a wildcard`);
        }
    });

    it("limits the list and rejects silly limits", async () => {
        assert.equal((await request(app).get("/api/tags?limit=1")).body.data.tags.length, 1);
        assert.equal((await request(app).get("/api/tags?limit=0")).status, 400);
        assert.equal((await request(app).get("/api/tags?limit=51")).status, 400);
        assert.equal((await request(app).get("/api/tags?q=" + "x".repeat(41))).status, 400);
    });

    it("shows one tag with its published count; unused or unknown tags are not found", async () => {
        const found = await request(app).get("/api/tags/react");
        assert.equal(found.status, 200);
        assert.deepEqual(found.body.data.tag, { id: found.body.data.tag.id, name: "react", slug: "react", postCount: 3 });

        assert.equal((await request(app).get("/api/tags/secret-topic")).status, 404, "only a draft uses it");
        assert.equal((await request(app).get("/api/tags/future-topic")).status, 404, "only a scheduled post uses it");
        assert.equal((await request(app).get("/api/tags/never-existed")).status, 404);
    });

    it("lists the published posts with a tag, and combines tag and category filters", async () => {
        const list = await request(app).get("/api/posts?tag=react");

        assert.equal(list.status, 200);
        assert.deepEqual(list.body.data.posts.map((p) => p.title).sort(), ["One", "Three", "Two"]);
        assert.equal(list.body.meta.pagination.total, 3);

        const category = await Category.create({ name: "Dev", slug: "dev" });
        const one = await Post.findOne({ where: { title: "One" } });
        await Post.update({ categoryId: category.id }, { where: { id: one.id } });
        const both = await request(app).get("/api/posts?tag=react&category=dev");
        assert.deepEqual(both.body.data.posts.map((p) => p.title), ["One"]);

        assert.equal((await request(app).get("/api/posts?tag=unknown")).status, 404);
        assert.equal((await request(app).get("/api/posts?tag=Bad_Slug")).status, 400);
    });

    it("pages through a tag's posts", async () => {
        const page = await request(app).get("/api/posts?tag=react&limit=2&page=2");

        assert.equal(page.body.data.posts.length, 1);
        assert.equal(page.body.meta.pagination.totalPages, 2);
    });
});

describe("managing tags", () => {
    let author;
    let editor;
    let tag;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        await createPost(editor.token, { title: "Uses tags", tags: ["reactjs", "Vue"], status: "published" });
        tag = await Tag.findOne({ where: { slug: "reactjs" } });
    });

    it("lets editors rename a tag's display name while its address stays the same", async () => {
        const response = await request(app).patch(`/api/tags/${tag.id}`).set(bearer(editor.token)).send({ name: "React.js" });
        assert.equal(response.status, 400, "dots are not allowed in tag names");

        const ok = await request(app).patch(`/api/tags/${tag.id}`).set(bearer(editor.token)).send({ name: "React JS" });
        assert.equal(ok.status, 200);
        assert.deepEqual([ok.body.data.tag.name, ok.body.data.tag.slug], ["React JS", "reactjs"]);
        assert.equal((await request(app).get("/api/tags/reactjs")).body.data.tag.name, "React JS");
    });

    it("refuses a rename that collides with another tag, invalid names, unknown ids and unauthorised callers", async () => {
        const clash = await request(app).patch(`/api/tags/${tag.id}`).set(bearer(editor.token)).send({ name: "vue" });
        assert.equal(clash.status, 409);

        for (const name of ["a", "bad!", "x".repeat(31)]) {
            assert.equal((await request(app).patch(`/api/tags/${tag.id}`).set(bearer(editor.token)).send({ name })).status, 400);
        }
        assert.equal((await request(app).patch("/api/tags/999999").set(bearer(editor.token)).send({ name: "Ghost" })).status, 404);
        assert.equal((await request(app).patch("/api/tags/abc").set(bearer(editor.token)).send({ name: "Ghost" })).status, 404);
        assert.equal((await request(app).patch(`/api/tags/${tag.id}`).set(bearer(editor.token)).send({ name: "Fine", slug: "other" })).status, 400);
        assert.equal((await request(app).patch(`/api/tags/${tag.id}`).set(bearer(author.token)).send({ name: "Mine" })).status, 403);
        assert.equal((await request(app).patch(`/api/tags/${tag.id}`).send({ name: "Anon" })).status, 401);
    });

    it("lets editors delete a tag: it is removed from every post and the posts stay", async () => {
        const vue = await Tag.findOne({ where: { slug: "vue" } });
        assert.equal((await request(app).delete(`/api/tags/${vue.id}`).set(bearer(author.token))).status, 403);

        const removed = await request(app).delete(`/api/tags/${vue.id}`).set(bearer(editor.token));

        assert.equal(removed.status, 200);
        assert.equal(await Tag.findByPk(vue.id), null);
        const post = await Post.findOne({ where: { title: "Uses tags" } });
        assert.ok(post, "the post is untouched");
        assert.equal(await PostTag.count({ where: { tagId: vue.id } }), 0);
        assert.equal((await request(app).delete(`/api/tags/${vue.id}`).set(bearer(editor.token))).status, 404);
    });

    it("records renames and deletions in the audit log", async () => {
        const entries = await AuditLog.findAll({ where: { entityType: "tag" }, order: [["id", "ASC"]] });

        assert.deepEqual(entries.map((entry) => entry.action), ["tag.renamed", "tag.deleted"]);
        assert.deepEqual(entries[0].metadata, { from: "reactjs", to: "React JS" });
        assert.equal(entries[1].metadata.name, "Vue");
        assert.equal(entries[1].metadata.posts, 1);
        assert.ok(entries.every((entry) => entry.actorId === editor.user.id));
    });
});
