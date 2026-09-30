import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";

const createPost = (token, body = { title: "A title", content: "Some content", status: "published" }) =>
    request(app).post("/api/posts").set("Authorization", `Bearer ${token}`).send(body);

const getPost = (id, token) => request(app).get(`/api/posts/${id}`).set("Authorization", `Bearer ${token}`);

describe("posts", () => {
    let owner;
    let stranger;

    after(closeDatabase);

    beforeEach(async () => {
        await resetDatabase();
        owner = await registerAndLogin();
        stranger = await registerAndLogin();
    });

    it("creates a post with the author embedded", async () => {
        const response = await createPost(owner.token);

        assert.equal(response.status, 201);
        assert.equal(response.body.post.title, "A title");
        assert.equal(response.body.post.author.id, owner.user.id);
        assert.equal(response.body.post.author.username, owner.credentials.userName);
        assert.ok(!JSON.stringify(response.body).includes("password"));
    });

    it("rejects creating a post without a token", async () => {
        const response = await request(app).post("/api/posts").send({ title: "x", content: "y" });

        assert.equal(response.status, 401);
    });

    it("rejects creating a post with a garbage token", async () => {
        const response = await createPost("not-a-real-token");

        assert.equal(response.status, 401);
    });

    it("rejects an empty body with 400", async () => {
        const response = await createPost(owner.token, {});

        assert.equal(response.status, 400);
    });

    it("rejects a blank title with 400", async () => {
        const response = await createPost(owner.token, { title: "   ", content: "Some content" });

        assert.equal(response.status, 400);
    });

    it("returns an empty list when no posts exist", async () => {
        const response = await request(app).get("/api/posts");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.posts, []);
        assert.deepEqual(response.body.pagination, { page: 1, limit: 10, total: 0, totalPages: 0 });
    });

    it("lists post previews without requiring a token", async () => {
        await createPost(owner.token);

        const response = await request(app).get("/api/posts");

        assert.equal(response.status, 200);
        assert.equal(response.body.posts.length, 1);
        const [preview] = response.body.posts;
        assert.equal(preview.excerpt, "Some content");
        assert.equal(preview.readingTime, 1);
        assert.equal(preview.author.id, owner.user.id);
        assert.ok(!("content" in preview));
    });

    it("cuts long content short in the list so the full story is not public", async () => {
        const content = "word ".repeat(500).trim();
        await createPost(owner.token, { title: "Long read", content, status: "published" });

        const response = await request(app).get("/api/posts");
        const [preview] = response.body.posts;

        assert.ok(preview.excerpt.length < content.length);
        assert.ok(preview.excerpt.endsWith("…"));
        assert.equal(preview.readingTime, 2);
    });

    it("gets a single post with full content when logged in", async () => {
        const created = await createPost(owner.token);

        const response = await getPost(created.body.post.id, stranger.token);

        assert.equal(response.status, 200);
        assert.equal(response.body.post.id, created.body.post.id);
        assert.equal(response.body.post.content, "Some content");
    });

    it("rejects reading a single post without a token", async () => {
        const created = await createPost(owner.token);

        const response = await request(app).get(`/api/posts/${created.body.post.id}`);

        assert.equal(response.status, 401);
    });

    it("returns 404 for a post id that does not exist", async () => {
        const response = await getPost(999999, owner.token);

        assert.equal(response.status, 404);
        assert.equal(response.body.error, "Post not found");
    });

    it("returns 404 for a non-numeric post id", async () => {
        const response = await getPost("abc", owner.token);

        assert.equal(response.status, 404);
    });

    it("updates only the supplied field when the owner patches a post", async () => {
        const created = await createPost(owner.token);

        const response = await request(app)
            .patch(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Updated title" });

        assert.equal(response.status, 200);
        assert.equal(response.body.post.title, "Updated title");
        assert.equal(response.body.post.content, created.body.post.content);
    });

    it("rejects a patch with an empty body", async () => {
        const created = await createPost(owner.token);

        const response = await request(app)
            .patch(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${owner.token}`)
            .send({});

        assert.equal(response.status, 400);
    });

    it("rejects a patch from someone who does not own the post", async () => {
        const created = await createPost(owner.token);

        const response = await request(app)
            .patch(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${stranger.token}`)
            .send({ title: "Hijacked" });

        assert.equal(response.status, 403);
        assert.equal(response.body.error, "Not authorized to update this post");
    });

    it("rejects a delete from someone who does not own the post", async () => {
        const created = await createPost(owner.token);

        const response = await request(app)
            .delete(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${stranger.token}`);

        assert.equal(response.status, 403);
        assert.equal(response.body.error, "Not authorized to delete this post");
    });

    it("returns 404 when patching or deleting a post that does not exist", async () => {
        const patched = await request(app)
            .patch("/api/posts/999999")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Nope" });

        const deleted = await request(app)
            .delete("/api/posts/999999")
            .set("Authorization", `Bearer ${owner.token}`);

        assert.equal(patched.status, 404);
        assert.equal(deleted.status, 404);
    });

    it("hard deletes a post so it no longer appears afterwards", async () => {
        const created = await createPost(owner.token);

        const response = await request(app)
            .delete(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${owner.token}`);

        assert.equal(response.status, 200);

        const afterDelete = await getPost(created.body.post.id, owner.token);
        const list = await request(app).get("/api/posts");

        assert.equal(afterDelete.status, 404);
        assert.deepEqual(list.body.posts, []);
    });

    it("defaults to draft status when status is omitted", async () => {
        const response = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "A title", content: "Some content" });

        assert.equal(response.status, 201);
        assert.equal(response.body.post.status, "draft");
    });

    it("excludes drafts from the public listing", async () => {
        await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Draft title", content: "Some content" });

        const response = await request(app).get("/api/posts");

        assert.deepEqual(response.body.posts, []);
    });

    it("lets the owner view their own draft", async () => {
        const created = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Draft title", content: "Some content" });

        const response = await getPost(created.body.post.id, owner.token);

        assert.equal(response.status, 200);
        assert.equal(response.body.post.status, "draft");
    });

    it("hides another user's draft with a 404", async () => {
        const created = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Draft title", content: "Some content" });

        const response = await getPost(created.body.post.id, stranger.token);

        assert.equal(response.status, 404);
        assert.equal(response.body.error, "Post not found");
    });

    it("publishing a draft makes it appear in the public listing", async () => {
        const created = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ title: "Draft title", content: "Some content" });

        const patchResponse = await request(app)
            .patch(`/api/posts/${created.body.post.id}`)
            .set("Authorization", `Bearer ${owner.token}`)
            .send({ status: "published" });

        assert.equal(patchResponse.status, 200);
        assert.equal(patchResponse.body.post.status, "published");

        const listResponse = await request(app).get("/api/posts");
        assert.equal(listResponse.body.posts.length, 1);
        assert.equal(listResponse.body.posts[0].id, created.body.post.id);
    });

    it("paginates the public listing with a default limit of 10", async () => {
        for (let i = 0; i < 12; i++) {
            await createPost(owner.token, { title: `Post ${i}`, content: "Some content", status: "published" });
        }

        const response = await request(app).get("/api/posts");

        assert.equal(response.body.posts.length, 10);
        assert.deepEqual(response.body.pagination, { page: 1, limit: 10, total: 12, totalPages: 2 });
    });

    it("returns the requested page", async () => {
        for (let i = 0; i < 12; i++) {
            await createPost(owner.token, { title: `Post ${i}`, content: "Some content", status: "published" });
        }

        const response = await request(app).get("/api/posts?page=2&limit=10");

        assert.equal(response.body.posts.length, 2);
        assert.deepEqual(response.body.pagination, { page: 2, limit: 10, total: 12, totalPages: 2 });
    });

    it("respects a custom limit", async () => {
        for (let i = 0; i < 3; i++) {
            await createPost(owner.token, { title: `Post ${i}`, content: "Some content", status: "published" });
        }

        const response = await request(app).get("/api/posts?limit=2");

        assert.equal(response.body.posts.length, 2);
        assert.equal(response.body.pagination.limit, 2);
    });

    it("clamps an out-of-range limit to the maximum", async () => {
        const response = await request(app).get("/api/posts?limit=1000");

        assert.equal(response.body.pagination.limit, 50);
    });
});
