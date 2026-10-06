import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { AuditLog, Post, PostRevision } from "../database/models/index.js";
import { MAX_REVISIONS_PER_POST } from "../config/posts.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const create = (token, body = {}) =>
    request(app).post("/api/posts").set(bearer(token)).send({ title: "A title", content: "Some content for the post.", ...body });
const edit = (token, id, body) => request(app).patch(`/api/posts/${id}`).set(bearer(token)).send(body);
const move = (token, id, to, extra = {}) => request(app).post(`/api/posts/${id}/status`).set(bearer(token)).send({ to, ...extra });
const revisions = (token, id, query = "") => request(app).get(`/api/posts/${id}/revisions${query}`).set(bearer(token));
const revision = (token, id, version) => request(app).get(`/api/posts/${id}/revisions/${version}`).set(bearer(token));
const compare = (token, id, query) => request(app).get(`/api/posts/${id}/revisions/compare?${query}`).set(bearer(token));
const restore = (token, id, version) => request(app).post(`/api/posts/${id}/revisions/${version}/restore`).set(bearer(token));

// make the newest revision look old, so the next edit is not merged into it
const ageLatestRevision = async (postId, minutes = 30) => {
    const latest = await PostRevision.findOne({ where: { postId }, order: [["version", "DESC"]] });
    await PostRevision.update({ createdAt: new Date(Date.now() - minutes * 60_000) }, { where: { id: latest.id } });
};

after(closeDatabase);

describe("slugs and excerpts", () => {
    let author;
    let editor;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
    });

    it("numbers colliding slugs: title, title-2, title-3", async () => {
        const slugs = [];
        for (let i = 0; i < 3; i += 1) slugs.push((await create(author.token, { title: "Same Title" })).body.data.post.slug);

        assert.deepEqual(slugs, ["same-title", "same-title-2", "same-title-3"]);
    });

    it("gives every one of several simultaneous posts with the same title its own slug", async () => {
        const responses = await Promise.all(Array.from({ length: 6 }, () => create(author.token, { title: "Race For The Slug" })));

        assert.ok(responses.every((response) => response.status === 201), JSON.stringify(responses.map((r) => r.status)));
        const slugs = responses.map((response) => response.body.data.post.slug);
        assert.equal(new Set(slugs).size, 6);
        assert.ok(slugs.every((slug) => slug.startsWith("race-for-the-slug")));
    });

    it("folds accents, and falls back to 'post' for titles with nothing usable", async () => {
        const accented = await create(author.token, { title: "Café Müller: une histoire" });
        const symbols = await create(author.token, { title: "!!! ???" });

        assert.equal(accented.body.data.post.slug, "cafe-muller-une-histoire");
        assert.equal(symbols.body.data.post.slug, "post");
    });

    it("accepts a chosen slug, rejects a taken one, and rejects malformed ones", async () => {
        const chosen = await create(author.token, { title: "Anything", slug: "My-Custom-URL" });
        assert.equal(chosen.body.data.post.slug, "my-custom-url", "case is normalized");

        const duplicate = await create(author.token, { title: "Another", slug: "my-custom-url" });
        assert.equal(duplicate.status, 409);
        assert.equal(duplicate.body.error.code, "SLUG_TAKEN");

        for (const slug of ["has space", "-leading", "trailing-", "double--hyphen", "under_score", "ünïcode", "a".repeat(101), "../etc", ""]) {
            assert.equal((await create(author.token, { title: "Bad slug", slug })).status, 400, `${JSON.stringify(slug)} must be rejected`);
        }
    });

    it("follows the title while unpublished, but leaves a chosen slug alone", async () => {
        const auto = (await create(author.token, { title: "First Draft Title" })).body.data.post;
        const custom = (await create(author.token, { title: "Some Title", slug: "pinned-url" })).body.data.post;

        const renamed = await edit(author.token, auto.id, { title: "A Much Better Title" });
        const renamedCustom = await edit(author.token, custom.id, { title: "Totally Different" });

        assert.equal(renamed.body.data.post.slug, "a-much-better-title");
        assert.equal(renamedCustom.body.data.post.slug, "pinned-url");
    });

    it("lets the author change the slug of an unpublished post, but never take someone else's", async () => {
        const post = (await create(author.token, { title: "Changing my mind" })).body.data.post;
        const other = (await create(author.token, { title: "Occupied", slug: "occupied-url" })).body.data.post;

        assert.equal((await edit(author.token, post.id, { slug: "new-url" })).body.data.post.slug, "new-url");
        const taken = await edit(author.token, post.id, { slug: "occupied-url" });
        assert.equal(taken.status, 409);
        assert.equal(taken.body.error.code, "SLUG_TAKEN");
        assert.ok(other.id);
    });

    it("freezes the URL at the first publication, even after unpublishing", async () => {
        const post = (await create(editor.token, { title: "Permanent Link" })).body.data.post;
        await move(editor.token, post.id, "published");

        const retitled = await edit(editor.token, post.id, { title: "A Different Title Entirely" });
        assert.equal(retitled.status, 200);
        assert.equal(retitled.body.data.post.slug, "permanent-link", "the URL does not follow the new title");

        const changed = await edit(editor.token, post.id, { slug: "something-else" });
        assert.equal(changed.status, 409);
        assert.equal(changed.body.error.code, "SLUG_LOCKED");
        assert.equal((await edit(editor.token, post.id, { slug: "permanent-link" })).status, 200, "re-sending the same slug is harmless");

        await move(editor.token, post.id, "draft");
        assert.equal((await edit(editor.token, post.id, { slug: "something-else" })).status, 409, "still frozen as a draft again");
        assert.equal((await request(app).get("/api/posts/slug/permanent-link").set(bearer(editor.token))).status, 200);
    });

    it("serves a published post at /slug/:slug without a login, and 404s otherwise", async () => {
        const post = (await create(editor.token, { title: "Open To All", status: "published" })).body.data.post;

        const open = await request(app).get(`/api/posts/slug/${post.slug}`);

        assert.equal(open.status, 200);
        assert.equal(open.body.data.post.content, "<p>Some content for the post.</p>");
        assert.equal((await request(app).get("/api/posts/slug/does-not-exist")).status, 404);
    });

    it("stores an excerpt and reading time on write and keeps them in step with the content", async () => {
        const long = `${"word ".repeat(700)}end`;
        const post = (await create(author.token, { title: "Long read", content: long })).body.data.post;

        assert.equal(post.excerpt.length, 320);
        assert.ok(post.excerpt.endsWith("…"));
        assert.equal(post.readingTime, 3);

        const short = await edit(author.token, post.id, { content: "Now it is short." });
        assert.equal(short.body.data.post.excerpt, "Now it is short.", "an automatic excerpt follows the content");
        assert.equal(short.body.data.post.readingTime, 1);
    });

    it("keeps a custom excerpt when the content changes, and goes back to automatic when it is cleared", async () => {
        const post = (await create(author.token, { title: "Teaser test", excerpt: "A hand-written teaser." })).body.data.post;
        assert.equal(post.excerpt, "A hand-written teaser.");

        const changed = await edit(author.token, post.id, { content: "Entirely new body text." });
        assert.equal(changed.body.data.post.excerpt, "A hand-written teaser.");

        const cleared = await edit(author.token, post.id, { excerpt: "" });
        assert.equal(cleared.body.data.post.excerpt, "Entirely new body text.");
        assert.equal((await edit(author.token, post.id, { excerpt: "x".repeat(321) })).status, 400);
    });

    it("never puts the body in a list", async () => {
        const list = await request(app).get("/api/posts");

        assert.ok(list.body.data.posts.every((post) => !("content" in post) && typeof post.excerpt === "string"));
    });
});

describe("revisions", () => {
    let author;
    let editor;
    let stranger;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
        stranger = await registerAndLogin({ role: "author" });
    });

    const newPost = async (owner = author, body = {}) => (await create(owner.token, { title: "Original title", content: "Line one.\nLine two.\nLine three.", ...body })).body.data.post;

    it("starts a history at version 1 when a post is created", async () => {
        const post = await newPost();

        const list = await revisions(author.token, post.id);

        assert.equal(list.status, 200);
        assert.equal(list.body.data.revisions.length, 1);
        const [first] = list.body.data.revisions;
        assert.equal(first.version, 1);
        assert.equal(first.reason, "created");
        assert.equal(first.title, "Original title");
        assert.equal(first.editor.id, author.user.id);
        assert.ok(!("content" in first), "the list leaves bodies out");
    });

    it("merges a burst of saves on an unpublished post into one revision", async () => {
        const post = await newPost();

        await edit(author.token, post.id, { content: "Edit one." });
        await edit(author.token, post.id, { content: "Edit two." });
        await edit(author.token, post.id, { title: "New title", content: "Edit three." });

        const list = await revisions(author.token, post.id);
        assert.equal(list.body.data.revisions.length, 1);
        const detail = await revision(author.token, post.id, 1);
        assert.equal(detail.body.data.revision.content, "<p>Edit three.</p>", "the single revision holds the latest save");
        assert.equal(detail.body.data.revision.title, "New title");
    });

    it("starts a new revision once the previous one is old enough", async () => {
        const post = await newPost();
        await edit(author.token, post.id, { content: "Morning draft." });
        await ageLatestRevision(post.id);

        await edit(author.token, post.id, { content: "Afternoon draft." });

        const list = await revisions(author.token, post.id);
        assert.deepEqual(list.body.data.revisions.map((r) => [r.version, r.reason]), [[2, "edited"], [1, "created"]]);
        assert.equal((await revision(author.token, post.id, 1)).body.data.revision.content, "<p>Morning draft.</p>", "the old version is intact");
    });

    it("does not record a revision when nothing changed", async () => {
        const post = await newPost();
        await ageLatestRevision(post.id);

        await edit(author.token, post.id, { content: "Line one.\nLine two.\nLine three." });
        await edit(author.token, post.id, { title: "Original title" });

        assert.equal((await revisions(author.token, post.id)).body.data.revisions.length, 1);
    });

    it("keeps every edit of a published post as its own revision", async () => {
        const post = await newPost(editor, { title: "Live post" });
        await move(editor.token, post.id, "published");

        await edit(editor.token, post.id, { content: "First live edit." });
        await edit(editor.token, post.id, { content: "Second live edit." });

        const list = await revisions(editor.token, post.id);
        assert.deepEqual(list.body.data.revisions.map((r) => r.version), [3, 2, 1]);
    });

    it("keeps only the newest 100 revisions of a post", async () => {
        const post = await newPost();
        await PostRevision.bulkCreate(
            Array.from({ length: MAX_REVISIONS_PER_POST - 1 }, (_, i) => ({
                postId: post.id, version: i + 2, title: "t", content: `body ${i}`, createdBy: author.user.id, reason: "edited", createdAt: new Date(Date.now() - 3600_000),
            })),
        );
        assert.equal(await PostRevision.count({ where: { postId: post.id } }), MAX_REVISIONS_PER_POST);

        await edit(author.token, post.id, { content: "One more, past the limit." });

        assert.equal(await PostRevision.count({ where: { postId: post.id } }), MAX_REVISIONS_PER_POST);
        const oldest = await PostRevision.min("version", { where: { postId: post.id } });
        assert.equal(oldest, 2, "version 1 was dropped to make room");
    });

    it("pages through the history, newest first", async () => {
        const post = await newPost();
        for (let i = 0; i < 4; i += 1) {
            await ageLatestRevision(post.id);
            await edit(author.token, post.id, { content: `Revision body ${i}` });
        }

        const page = await revisions(author.token, post.id, "?limit=2&page=2");

        assert.deepEqual(page.body.data.revisions.map((r) => r.version), [3, 2]);
        assert.equal(page.body.meta.pagination.total, 5);
    });

    it("compares two versions line by line, including against the current text", async () => {
        const post = await newPost(author, { content: "Alpha\nBravo\nCharlie\n" });
        await ageLatestRevision(post.id);
        await edit(author.token, post.id, { title: "Retitled", content: "Alpha\nBeta\nCharlie\nDelta\n" });

        const diff = await compare(author.token, post.id, "from=1&to=2");

        assert.equal(diff.status, 200);
        const { comparison } = diff.body.data;
        assert.deepEqual(comparison.title, { changed: true, from: "Original title", to: "Retitled" });
        assert.deepEqual(comparison.stats, { added: 2, removed: 1 });
        const removed = comparison.content.filter((p) => p.type === "remove").map((p) => p.value.trim());
        const added = comparison.content.filter((p) => p.type === "add").map((p) => p.value.trim());
        assert.deepEqual(removed, ["Bravo"]);
        assert.deepEqual(added, ["Beta", "Delta"]);

        const current = await compare(author.token, post.id, "from=1&to=current");
        assert.equal(current.body.data.comparison.to.version, null);
        assert.equal(current.body.data.comparison.title.to, "Retitled");
    });

    it("rejects bad comparison requests", async () => {
        const post = await newPost();

        assert.equal((await compare(author.token, post.id, "from=1")).status, 400);
        assert.equal((await compare(author.token, post.id, "from=abc&to=1")).status, 400);
        assert.equal((await compare(author.token, post.id, "from=1&to=nope")).status, 400);
        assert.equal((await compare(author.token, post.id, "from=1&to=99")).status, 404);
        assert.equal((await revision(author.token, post.id, 99)).status, 404);
        assert.equal((await revision(author.token, post.id, "abc")).status, 404);
    });

    it("restores an earlier version as a new revision, and updates what readers see", async () => {
        const post = await newPost(editor, { title: "Restorable", content: "The original text." });
        await move(editor.token, post.id, "published");
        await edit(editor.token, post.id, { content: `${"Much longer replacement text. ".repeat(300)}` });

        const response = await restore(editor.token, post.id, 1);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.post.content, "<p>The original text.</p>");
        assert.equal(response.body.data.post.readingTime, 1);
        assert.equal(response.body.data.post.slug, "restorable", "the URL is untouched");
        assert.equal(response.body.data.post.status, "published", "restoring does not change the status");

        const list = await revisions(editor.token, post.id);
        assert.deepEqual(list.body.data.revisions.map((r) => [r.version, r.reason]), [[3, "restored"], [2, "edited"], [1, "created"]]);
        const audit = await AuditLog.findOne({ where: { action: "post.revision_restored", entityId: String(post.id) } });
        assert.deepEqual(audit.metadata, { restoredVersion: 1, newVersion: 3 });
    });

    it("refuses to restore what is already current, and while the post is locked", async () => {
        const post = await newPost();
        assert.equal((await restore(author.token, post.id, 1)).status, 400);

        await ageLatestRevision(post.id);
        await edit(author.token, post.id, { content: "Changed." });
        await move(author.token, post.id, "pending_review");
        const locked = await restore(author.token, post.id, 1);
        assert.equal(locked.status, 409);
        assert.equal(locked.body.error.code, "POST_LOCKED");
    });

    it("shows history to the author and to editors for posts they can see, and to nobody else", async () => {
        const draft = await newPost();
        const pending = await newPost();
        await move(author.token, pending.id, "pending_review");
        const live = await newPost(editor, { title: "Public one" });
        await move(editor.token, live.id, "published");

        assert.equal((await revisions(author.token, draft.id)).status, 200);
        assert.equal((await revisions(editor.token, draft.id)).status, 404, "an editor does not see other people's drafts, nor their history");
        assert.equal((await revisions(editor.token, pending.id)).status, 200, "but does see a post in review");
        assert.equal((await revisions(stranger.token, pending.id)).status, 404);
        assert.equal((await revisions(stranger.token, live.id)).status, 404, "a published post's history is not public");
        assert.equal((await request(app).get(`/api/posts/${live.id}/revisions`)).status, 401);
        assert.equal((await revision(stranger.token, draft.id, 1)).status, 404);
        assert.equal((await compare(stranger.token, draft.id, "from=1&to=current")).status, 404);
    });

    it("lets only the author restore: an editor can read the history but not rewrite it", async () => {
        const post = await newPost();
        await ageLatestRevision(post.id);
        await edit(author.token, post.id, { content: "Second version." });
        await move(author.token, post.id, "pending_review");

        assert.equal((await restore(editor.token, post.id, 1)).status, 403);
        assert.equal((await restore(stranger.token, post.id, 1)).status, 404);
        assert.equal((await request(app).post(`/api/posts/${post.id}/revisions/1/restore`)).status, 401);
    });

    it("deletes the history together with the post", async () => {
        const post = await newPost();
        await ageLatestRevision(post.id);
        await edit(author.token, post.id, { content: "Another version." });
        assert.equal(await PostRevision.count({ where: { postId: post.id } }), 2);

        assert.equal((await request(app).delete(`/api/posts/${post.id}`).set(bearer(author.token))).status, 200);

        assert.equal(await PostRevision.count({ where: { postId: post.id } }), 0);
        assert.equal(await Post.findByPk(post.id), null);
    });

    it("records which revision a status decision applied to", async () => {
        const post = await newPost();
        await ageLatestRevision(post.id);
        await edit(author.token, post.id, { content: "Submitted version." });
        await move(author.token, post.id, "pending_review");

        const audit = await AuditLog.findOne({ where: { action: "post.status_changed", entityId: String(post.id) } });

        assert.equal(audit.metadata.revision, 2);
    });
});
