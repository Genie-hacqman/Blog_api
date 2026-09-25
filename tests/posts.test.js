import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";

const createPost = (token, body = { title: "A title", content: "Some content" }) =>
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
        await createPost(owner.token, { title: "Long read", content });

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
});
