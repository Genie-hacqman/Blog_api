import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";

const body = { title: "Idempotent post", content: "Retries must not duplicate this." };

const createWithKey = (token, key, payload = body) =>
    request(app)
        .post("/api/posts")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(payload);

describe("idempotency", () => {
    let user;

    after(closeDatabase);

    beforeEach(async () => {
        await resetDatabase();
        user = await registerAndLogin();
    });

    it("replays the first response instead of creating a duplicate", async () => {
        const first = await createWithKey(user.token, "key-1");
        const second = await createWithKey(user.token, "key-1");

        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        assert.equal(second.body.post.id, first.body.post.id);

        const list = await request(app).get("/api/posts");
        assert.equal(list.body.posts.length, 1);
    });

    it("rejects the same key used with a different body", async () => {
        await createWithKey(user.token, "key-2");

        const response = await createWithKey(user.token, "key-2", {
            title: "A different post",
            content: "Different content entirely.",
        });

        assert.equal(response.status, 409);
        assert.equal(
            response.body.error,
            "Idempotency-Key has already been used with a different request body"
        );

        const list = await request(app).get("/api/posts");
        assert.equal(list.body.posts.length, 1);
    });

    it("scopes keys per user so two users can reuse the same key string", async () => {
        const other = await registerAndLogin();

        const mine = await createWithKey(user.token, "shared-key");
        const theirs = await createWithKey(other.token, "shared-key", {
            title: "Other user post",
            content: "Written by a different user.",
        });

        assert.equal(mine.status, 201);
        assert.equal(theirs.status, 201);
        assert.notEqual(theirs.body.post.id, mine.body.post.id);
        assert.equal(theirs.body.post.author.id, other.user.id);
    });

    it("creates separate posts when no idempotency key is sent", async () => {
        const first = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${user.token}`)
            .send(body);

        const second = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${user.token}`)
            .send(body);

        assert.notEqual(second.body.post.id, first.body.post.id);

        const list = await request(app).get("/api/posts");
        assert.equal(list.body.posts.length, 2);
    });
});
