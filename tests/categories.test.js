import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Category, Post } from "../database/models/index.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const createCategory = (token, body) => request(app).post("/api/categories").set(bearer(token)).send(body);
const updateCategory = (token, id, body) => request(app).patch(`/api/categories/${id}`).set(bearer(token)).send(body);
const createPost = (token, body = {}) =>
    request(app).post("/api/posts").set(bearer(token)).send({ title: "A post", content: "Some content for the post.", ...body });
const move = (token, id, to, extra = {}) => request(app).post(`/api/posts/${id}/status`).set(bearer(token)).send({ to, ...extra });

after(closeDatabase);

describe("categories", () => {
    let author;
    let editor;
    let admin;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        admin = await registerAndLogin({ role: "admin" });
    });

    it("lets editors and admins create categories; authors and visitors cannot", async () => {
        assert.equal((await createCategory(editor.token, { name: "Technology" })).status, 201);
        assert.equal((await createCategory(admin.token, { name: "Culture", description: "Books and film." })).status, 201);

        const asAuthor = await createCategory(author.token, { name: "Sneaky" });
        assert.equal(asAuthor.status, 403);
        assert.equal(asAuthor.body.error.code, "FORBIDDEN");
        assert.equal((await request(app).post("/api/categories").send({ name: "Anonymous" })).status, 401);
        assert.equal(await Category.count({ where: { name: ["Sneaky", "Anonymous"] } }), 0);
    });

    it("generates the slug from the name, tidies spacing, and returns the category", async () => {
        const response = await createCategory(editor.token, { name: "  Science   &  Nature  ", description: "  Out in the world.  " });

        assert.equal(response.status, 201);
        assert.deepEqual(response.body.data.category, { id: response.body.data.category.id, name: "Science & Nature", slug: "science-nature", description: "Out in the world." });
    });

    it("refuses a duplicate name, whatever its case, and numbers slugs that collide", async () => {
        const duplicate = await createCategory(editor.token, { name: "TECHNOLOGY" });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.body.error.message, "A category with that name already exists");

        const first = await createCategory(editor.token, { name: "Sci Fi" });
        const second = await createCategory(editor.token, { name: "Sci-Fi" });
        assert.equal(first.body.data.category.slug, "sci-fi");
        assert.equal(second.body.data.category.slug, "sci-fi-2");
    });

    it("validates names and descriptions, and rejects keys it does not own", async () => {
        const cases = [
            {},
            { name: "" },
            { name: "x" },
            { name: "x".repeat(61) },
            { name: 42 },
            { name: "Fine", description: "d".repeat(301) },
            { name: "Fine", slug: "chosen-by-client" },
            { name: "Fine", id: 99 },
            { name: "Fine", postCount: 5 },
        ];
        for (const body of cases) {
            assert.equal((await createCategory(editor.token, body)).status, 400, `${JSON.stringify(body).slice(0, 50)} must be rejected`);
        }
    });

    it("lists categories alphabetically with the number of published posts only", async () => {
        const tech = (await Category.findOne({ where: { slug: "technology" } })).id;
        const culture = (await Category.findOne({ where: { slug: "culture" } })).id;

        const live = await createPost(editor.token, { title: "Published tech", categoryId: tech, status: "published" });
        await createPost(editor.token, { title: "Draft tech", categoryId: tech });
        const pending = await createPost(author.token, { title: "Pending tech", categoryId: tech });
        await move(author.token, pending.body.data.post.id, "pending_review");
        const scheduled = await createPost(editor.token, { title: "Scheduled tech", categoryId: tech });
        await Post.update({ status: "scheduled", scheduledAt: new Date(Date.now() + 3600_000) }, { where: { id: scheduled.body.data.post.id } });
        await createPost(editor.token, { title: "Published culture", categoryId: culture, status: "published" });
        assert.equal(live.status, 201);

        const response = await request(app).get("/api/categories");

        assert.equal(response.status, 200);
        const byName = Object.fromEntries(response.body.data.categories.map((c) => [c.name, c.postCount]));
        assert.equal(byName.Technology, 1, "only the published post counts");
        assert.equal(byName.Culture, 1);
        assert.equal(byName["Science & Nature"], 0);
        const names = response.body.data.categories.map((c) => c.name);
        assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    });

    it("shows one category by slug, 404 for an unknown one, with no login", async () => {
        const found = await request(app).get("/api/categories/technology");
        assert.equal(found.status, 200);
        assert.equal(found.body.data.category.name, "Technology");
        assert.equal(found.body.data.category.postCount, 1);

        assert.equal((await request(app).get("/api/categories/nope")).status, 404);
        assert.equal((await request(app).get("/api/categories/Not_A_Slug!")).status, 404);
    });

    it("renames without changing the slug, so links keep working", async () => {
        const category = (await Category.findOne({ where: { slug: "culture" } }));

        const response = await updateCategory(editor.token, category.id, { name: "Arts & Culture", description: "" });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.category.name, "Arts & Culture");
        assert.equal(response.body.data.category.slug, "culture");
        assert.equal(response.body.data.category.description, null, "an empty description clears it");
        assert.equal((await request(app).get("/api/categories/culture")).body.data.category.name, "Arts & Culture");
    });

    it("refuses renaming onto another category's name, but allows keeping its own", async () => {
        const culture = await Category.findOne({ where: { slug: "culture" } });

        assert.equal((await updateCategory(editor.token, culture.id, { name: "technology" })).status, 409);
        assert.equal((await updateCategory(editor.token, culture.id, { name: "Arts & Culture" })).status, 200);
    });

    it("needs a change, a known id, and an editor", async () => {
        const culture = await Category.findOne({ where: { slug: "culture" } });

        assert.equal((await updateCategory(editor.token, culture.id, {})).status, 400);
        assert.equal((await updateCategory(editor.token, culture.id, { slug: "hijack" })).status, 400);
        assert.equal((await updateCategory(editor.token, 999999, { name: "Ghost" })).status, 404);
        assert.equal((await updateCategory(editor.token, "abc", { name: "Ghost" })).status, 404);
        assert.equal((await updateCategory(author.token, culture.id, { name: "Mine now" })).status, 403);
        assert.equal((await request(app).patch(`/api/categories/${culture.id}`).send({ name: "Anon" })).status, 401);
    });

    it("deleting a category keeps its posts and leaves them uncategorized", async () => {
        const doomed = (await createCategory(editor.token, { name: "Doomed" })).body.data.category;
        const post = (await createPost(editor.token, { title: "Survivor", categoryId: doomed.id, status: "published" })).body.data.post;

        assert.equal((await request(app).delete(`/api/categories/${doomed.id}`).set(bearer(author.token))).status, 403);
        const removed = await request(app).delete(`/api/categories/${doomed.id}`).set(bearer(editor.token));

        assert.equal(removed.status, 200);
        assert.equal((await request(app).get(`/api/categories/${doomed.slug}`)).status, 404);
        const survivor = await request(app).get(`/api/posts/slug/${post.slug}`);
        assert.equal(survivor.status, 200);
        assert.equal(survivor.body.data.post.category, null);
        assert.equal((await request(app).delete(`/api/categories/${doomed.id}`).set(bearer(editor.token))).status, 404);
    });

    it("records every change in the audit log", async () => {
        const entries = await AuditLog.findAll({ where: { entityType: "category" }, order: [["id", "ASC"]] });
        const actions = entries.map((entry) => entry.action);

        assert.ok(actions.includes("category.created"));
        assert.ok(actions.includes("category.updated"));
        assert.ok(actions.includes("category.deleted"));
        const renamed = entries.find((entry) => entry.action === "category.updated" && entry.metadata.to === "Arts & Culture");
        assert.equal(renamed.metadata.from, "Culture");
        assert.equal(renamed.actorId, editor.user.id);
    });
});

describe("a post's category", () => {
    let author;
    let editor;
    let category;
    let other;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        category = (await createCategory(editor.token, { name: "Technology" })).body.data.category;
        other = (await createCategory(editor.token, { name: "Culture" })).body.data.category;
    });

    it("is chosen when writing, returned in the post, and can be changed or cleared", async () => {
        const created = await createPost(author.token, { categoryId: category.id });
        assert.equal(created.status, 201);
        assert.deepEqual(created.body.data.post.category, { id: category.id, name: "Technology", slug: "technology" });
        const id = created.body.data.post.id;

        const moved = await request(app).patch(`/api/posts/${id}`).set(bearer(author.token)).send({ categoryId: other.id });
        assert.equal(moved.body.data.post.category.slug, "culture");

        const cleared = await request(app).patch(`/api/posts/${id}`).set(bearer(author.token)).send({ categoryId: null });
        assert.equal(cleared.body.data.post.category, null);
    });

    it("must exist: a clear message, never a database error", async () => {
        const created = await createPost(author.token, { categoryId: 999999 });
        assert.equal(created.status, 400);
        assert.equal(created.body.error.message, "That category does not exist");

        const post = (await createPost(author.token)).body.data.post;
        const edited = await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ categoryId: 999999 });
        assert.equal(edited.status, 400);
        for (const bad of ["abc", 0, -1, 1.5, "1"]) {
            assert.equal((await createPost(author.token, { categoryId: bad })).status, 400, `${JSON.stringify(bad)} must be rejected`);
        }
    });

    it("can be changed only by the post's owner, and not while the post waits for review", async () => {
        const post = (await createPost(author.token, { categoryId: category.id })).body.data.post;

        const byEditor = await request(app).patch(`/api/posts/${post.id}`).set(bearer(editor.token)).send({ categoryId: other.id });
        assert.equal(byEditor.status, 404, "an editor cannot even see another author's draft");

        await move(author.token, post.id, "pending_review");
        const locked = await request(app).patch(`/api/posts/${post.id}`).set(bearer(author.token)).send({ categoryId: other.id });
        assert.equal(locked.status, 409);
        assert.equal(locked.body.error.code, "POST_LOCKED");
    });

    it("lists only published posts of a category, newest first, and 404s for an unknown one", async () => {
        await Post.destroy({ where: {} });
        const older = (await createPost(editor.token, { title: "Older", categoryId: category.id, status: "published" })).body.data.post;
        const newer = (await createPost(editor.token, { title: "Newer", categoryId: category.id, status: "published" })).body.data.post;
        await Post.update({ publishedAt: new Date("2026-03-01T00:00:00Z") }, { where: { id: newer.id } });
        await Post.update({ publishedAt: new Date("2026-01-01T00:00:00Z") }, { where: { id: older.id } });
        await createPost(editor.token, { title: "Draft", categoryId: category.id });
        await createPost(editor.token, { title: "Elsewhere", categoryId: other.id, status: "published" });

        const list = await request(app).get("/api/posts?category=technology");

        assert.equal(list.status, 200);
        assert.deepEqual(list.body.data.posts.map((p) => p.title), ["Newer", "Older"]);
        assert.equal(list.body.data.posts[0].category.slug, "technology");
        assert.equal(list.body.meta.pagination.total, 2);
        assert.equal((await request(app).get("/api/posts?category=nope")).status, 404);
        assert.equal((await request(app).get("/api/posts?category=Bad_Slug")).status, 400);
    });
});
