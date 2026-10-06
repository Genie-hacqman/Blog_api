import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { makeImage } from "./imageHelpers.js";
import { Media, Post, PostMedia } from "../database/models/index.js";
import { clearStoredFiles } from "../providers/storage/memory.js";
import { MAX_IMAGES_PER_POST, MAX_TEXT_LENGTH } from "../config/posts.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const create = (token, body = {}) => request(app).post("/api/posts").set(bearer(token)).send({ title: "A title", content: "<p>Some content</p>", ...body });
const edit = (token, id, body) => request(app).patch(`/api/posts/${id}`).set(bearer(token)).send(body);
const read = (token, id) => request(app).get(`/api/posts/${id}`).set(bearer(token));
const upload = async (token, purpose) =>
    request(app).post("/api/media").set(bearer(token)).field("purpose", purpose).attach("file", await makeImage(), { filename: "p.jpg", contentType: "image/jpeg" });
const uploaded = async (token, purpose) => (await upload(token, purpose)).body.data.media;
const sql = (query, replacements) => sequelize.query(query, { replacements });
const select = async (query, replacements) => sequelize.query(query, { replacements, type: "SELECT" });

after(closeDatabase);

describe("rich content: storage and sanitizing", () => {
    let author;

    before(resetDatabase);
    before(async () => {
        author = await registerAndLogin({ role: "author" });
    });

    it("stores sanitized HTML and derives the excerpt, reading time and text from the words only", async () => {
        const response = await create(author.token, { content: '<h2>Intro</h2><p>Hello &amp; <strong>welcome</strong> to <a href="https://example.com/x">my blog</a>.</p>' });

        assert.equal(response.status, 201);
        const { post } = response.body.data;
        assert.equal(post.excerpt, "Intro Hello & welcome to my blog.");
        assert.equal(post.readingTime, 1);
        assert.match(post.content, /<a href="https:\/\/example\.com\/x" rel="noopener noreferrer nofollow ugc">my blog<\/a>/);
        assert.equal((await Post.findByPk(post.id)).contentText, "Intro Hello & welcome to my blog.");
    });

    it("reading time counts words, not markup", async () => {
        const body = `<p>${"word ".repeat(450)}</p>`;
        assert.equal((await create(author.token, { content: body })).body.data.post.readingTime, 2);
        const noisy = `<p>${'<strong>w</strong> '.repeat(30)}</p>`;
        assert.equal((await create(author.token, { content: noisy })).body.data.post.readingTime, 1);
    });

    it("wraps plain text sent by an API client into paragraphs", async () => {
        const { post } = (await create(author.token, { content: "Line one.\nLine two.\n\nA & B, and 2 < 3." })).body.data;

        assert.equal(post.content, "<p>Line one.<br />Line two.</p><p>A &amp; B, and 2 &lt; 3.</p>");
    });

    it("neutralizes scripts, handlers and bad URLs, on create and on edit, and in every response", async () => {
        const hostile =
            '<p onclick="steal()">Hi</p><script>steal()</script><img onerror="steal()"><img src="data:image/gif;base64,R0lGOD" onerror="steal()"><a href="javascript:steal()">go</a><iframe src="https://evil.example"></iframe><svg onload="steal()"></svg>';
        const created = (await create(author.token, { content: hostile })).body.data.post;
        const edited = (await edit(author.token, created.id, { content: hostile })).body.data.post;

        for (const post of [created, edited, (await read(author.token, created.id)).body.data.post]) {
            assert.ok(!/script|onclick|onerror|javascript:|iframe|svg|steal/i.test(post.content), `unsafe markup survived: ${post.content}`);
        }
    });

    it("rejects a body with no text, whatever markup surrounds it", async () => {
        for (const content of ["<p></p>", "<p> </p>", "<script>alert(1)</script>", "<img src=x>", "   "]) {
            const response = await create(author.token, { content });
            assert.equal(response.status, 400, JSON.stringify(content));
            assert.equal(response.body.error.code, "VALIDATION_ERROR");
        }
    });

    it("enforces the size of the HTML, the size of the text and the nesting depth", async () => {
        const tooMuchHtml = await create(author.token, { content: "<p>x</p>".repeat(30_000) });
        assert.equal(tooMuchHtml.status, 400);

        const tooMuchText = await create(author.token, { content: `<p>${"a".repeat(MAX_TEXT_LENGTH + 1)}</p>` });
        assert.equal(tooMuchText.status, 400);
        assert.match(tooMuchText.body.error.message, /characters of text/);

        const tooDeep = await create(author.token, { content: `${"<blockquote>".repeat(40)}x${"</blockquote>".repeat(40)}` });
        assert.equal(tooDeep.status, 400);
        assert.match(tooDeep.body.error.message, /nested too deeply/);

        const atLimit = await create(author.token, { content: `<p>${"a".repeat(MAX_TEXT_LENGTH)}</p>` });
        assert.equal(atLimit.status, 201);
    });

    it("saving the same content again is a success that changes nothing", async () => {
        const post = (await create(author.token, { content: "<p>Stable</p>" })).body.data.post;
        await sql("UPDATE `Posts` SET updatedAt = '2030-01-02 03:04:05' WHERE id = :id", { id: post.id });

        const again = await edit(author.token, post.id, { title: post.title, content: "<p>Stable</p>" });

        assert.equal(again.status, 200);
        assert.equal(new Date(again.body.data.post.updatedAt).getUTCFullYear(), 2030, "updatedAt was not touched");
        const revisions = await select("SELECT COUNT(*) AS n FROM `post_revisions` WHERE postId = :id", { id: post.id });
        assert.equal(Number(revisions[0].n), 1, "no new revision");
    });

    it("an automatic excerpt follows the text, a custom one stays", async () => {
        const auto = (await create(author.token, { content: "<p>First words.</p>" })).body.data.post;
        const custom = (await create(author.token, { content: "<p>First words.</p>", excerpt: "Mine" })).body.data.post;

        assert.equal((await edit(author.token, auto.id, { content: "<p>Other words.</p>" })).body.data.post.excerpt, "Other words.");
        assert.equal((await edit(author.token, custom.id, { content: "<p>Other words.</p>" })).body.data.post.excerpt, "Mine");
    });
});

describe("rich content: images", () => {
    let author;
    let other;

    before(resetDatabase);
    before(async () => {
        clearStoredFiles();
        author = await registerAndLogin({ role: "author" });
        other = await registerAndLogin({ role: "author" });
    });

    it("accepts the author's own inline uploads, records them, and keeps the alt text", async () => {
        const image = await uploaded(author.token, "inline");

        const response = await create(author.token, { content: `<p>See</p><img src="${image.url}" alt="A red box">` });

        assert.equal(response.status, 201);
        assert.match(response.body.data.post.content, /<img src="[^"]+" alt="A red box" loading="lazy" \/>/);
        const links = await PostMedia.findAll({ where: { postId: response.body.data.post.id } });
        assert.deepEqual(links.map((link) => link.mediaId), [image.id]);
    });

    it("refuses images from other sites, however they are written", async () => {
        const attempts = [
            '<img src="https://evil.example/pixel.png">',
            '<img src="/media/../secret.png">',
            '<img src="/media/u/999/00000000-0000-0000-0000-000000000000.webp">',
            '<img src="relative.png">',
        ];
        for (const image of attempts) {
            const response = await create(author.token, { content: `<p>x</p>${image}` });
            assert.equal(response.status, 400, image);
            assert.equal(response.body.error.code, "INVALID_IMAGE", image);
        }
    });

    it("silently removes images the sanitizer will not allow at all (protocol-relative and data: sources)", async () => {
        for (const image of ['<img src="//evil.example/pixel.png">', '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">']) {
            const response = await create(author.token, { content: `<p>x</p>${image}` });
            assert.equal(response.status, 201, image);
            assert.ok(!response.body.data.post.content.includes("<img"), image);
        }
    });

    it("refuses another user's image, a query-string trick, a cover used inline, and a deleted image", async () => {
        const theirs = await uploaded(other.token, "inline");
        const mine = await uploaded(author.token, "inline");
        const cover = await uploaded(author.token, "cover");
        const gone = await uploaded(author.token, "inline");
        assert.equal((await request(app).delete(`/api/media/${gone.id}`).set(bearer(author.token))).status, 200);

        for (const [label, url] of [["theirs", theirs.url], ["query", `${mine.url}?x=1`], ["cover", cover.url], ["deleted", gone.url]]) {
            const response = await create(author.token, { content: `<p>x</p><img src="${url}">` });
            assert.equal(response.status, 400, label);
            assert.equal(response.body.error.code, "INVALID_IMAGE", label);
        }
    });

    it("limits the number of images in one post", async () => {
        const images = Array.from({ length: MAX_IMAGES_PER_POST + 1 }, (_, i) => `<img src="/media/u/${author.user.id}/00000000-0000-0000-0000-${String(i).padStart(12, "0")}.webp">`).join("");

        const response = await create(author.token, { content: `<p>x</p>${images}` });

        assert.equal(response.status, 400);
        assert.match(response.body.error.message, new RegExp(`at most ${MAX_IMAGES_PER_POST} images`));
    });

    it("keeps the list of images in step with the content, and protects an image that is in use", async () => {
        const image = await uploaded(author.token, "inline");
        const post = (await create(author.token, { content: `<p>x</p><img src="${image.url}">` })).body.data.post;

        const blocked = await request(app).delete(`/api/media/${image.id}`).set(bearer(author.token));
        assert.equal(blocked.status, 409);
        assert.equal(blocked.body.error.code, "MEDIA_IN_USE");

        await edit(author.token, post.id, { content: "<p>No image any more</p>" });
        assert.equal(await PostMedia.count({ where: { postId: post.id } }), 0);
        assert.equal((await request(app).delete(`/api/media/${image.id}`).set(bearer(author.token))).status, 200);
    });

    it("deleting a post releases its images", async () => {
        const image = await uploaded(author.token, "inline");
        const post = (await create(author.token, { content: `<p>x</p><img src="${image.url}">` })).body.data.post;

        assert.equal((await request(app).delete(`/api/posts/${post.id}`).set(bearer(author.token))).status, 200);

        assert.equal(await PostMedia.count({ where: { mediaId: image.id } }), 0);
        assert.equal((await request(app).delete(`/api/media/${image.id}`).set(bearer(author.token))).status, 200);
    });
});

describe("rich content: cover image", () => {
    let author;
    let other;

    before(resetDatabase);
    before(async () => {
        clearStoredFiles();
        author = await registerAndLogin({ role: "author" });
        other = await registerAndLogin({ role: "author" });
    });

    it("sets a cover with a description, shows it in the post and in previews, and clears it", async () => {
        const cover = await uploaded(author.token, "cover");
        const editor = await registerAndLogin({ role: "editor" });
        const created = await create(editor.token, { status: "published", coverMediaId: (await uploaded(editor.token, "cover")).id, coverAlt: "  A sunrise  " });

        assert.equal(created.status, 201);
        assert.deepEqual(Object.keys(created.body.data.post.cover).sort(), ["alt", "height", "id", "url", "width"]);
        assert.equal(created.body.data.post.cover.alt, "A sunrise");

        const list = await request(app).get("/api/posts");
        assert.equal(list.body.data.posts[0].cover.alt, "A sunrise");
        assert.ok(list.body.data.posts[0].cover.url.startsWith("/media/u/"));

        const mine = (await create(author.token)).body.data.post;
        const set = await edit(author.token, mine.id, { coverMediaId: cover.id, coverAlt: "Hills" });
        assert.equal(set.body.data.post.cover.id, cover.id);

        const cleared = await edit(author.token, mine.id, { coverMediaId: null });
        assert.equal(cleared.body.data.post.cover, null);
        assert.equal((await Post.findByPk(mine.id)).coverAlt, null, "the description goes with the image");
    });

    it("the description alone changes an existing cover's alt text, and means nothing without a cover", async () => {
        const cover = await uploaded(author.token, "cover");
        const post = (await create(author.token, { coverMediaId: cover.id, coverAlt: "Before" })).body.data.post;
        assert.equal((await edit(author.token, post.id, { coverAlt: "After" })).body.data.post.cover.alt, "After");

        const bare = (await create(author.token)).body.data.post;
        assert.equal((await edit(author.token, bare.id, { coverAlt: "Orphan" })).status, 200);
        assert.equal((await Post.findByPk(bare.id)).coverAlt, null);
    });

    it("refuses someone else's image, an image of the wrong kind, a missing one and a deleted one", async () => {
        const theirs = await uploaded(other.token, "cover");
        const inline = await uploaded(author.token, "inline");
        const avatarLike = await Media.create({ ownerId: author.user.id, key: `u/${author.user.id}/avatar-like.webp`, mime: "image/webp", size: 1, width: 1, height: 1, purpose: "avatar" });
        const deleted = await uploaded(author.token, "cover");
        await request(app).delete(`/api/media/${deleted.id}`).set(bearer(author.token));

        for (const id of [theirs.id, inline.id, avatarLike.id, deleted.id, 999999]) {
            const response = await create(author.token, { coverMediaId: id });
            assert.equal(response.status, 400, String(id));
            assert.match(response.body.error.message, /cover image does not exist/);
        }
        assert.equal((await create(author.token, { coverMediaId: "5" })).status, 400, "ids are numbers");
    });

    it("an image used as a cover cannot be deleted until the cover is removed", async () => {
        const cover = await uploaded(author.token, "cover");
        const post = (await create(author.token, { coverMediaId: cover.id })).body.data.post;

        const blocked = await request(app).delete(`/api/media/${cover.id}`).set(bearer(author.token));
        assert.equal(blocked.status, 409);

        await edit(author.token, post.id, { coverMediaId: null });
        assert.equal((await request(app).delete(`/api/media/${cover.id}`).set(bearer(author.token))).status, 200);
    });
});

describe("rich content: autosave conflicts, search and history", () => {
    let author;
    let editor;

    before(resetDatabase);
    before(async () => {
        clearStoredFiles();
        author = await registerAndLogin({ role: "author" });
        editor = await registerAndLogin({ role: "editor" });
    });

    it("refuses a save that started from an older version (EDIT_CONFLICT), and accepts one that started from the current version", async () => {
        const post = (await create(author.token)).body.data.post;
        const stale = post.updatedAt;
        await sql("UPDATE `Posts` SET updatedAt = '2031-05-06 07:08:09' WHERE id = :id", { id: post.id });

        const conflict = await edit(author.token, post.id, { content: "<p>From the old tab</p>", expectedUpdatedAt: stale });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error.code, "EDIT_CONFLICT");
        assert.match((await read(author.token, post.id)).body.data.post.content, /Some content/, "nothing was overwritten");

        const current = (await read(author.token, post.id)).body.data.post.updatedAt;
        const saved = await edit(author.token, post.id, { content: "<p>From the current tab</p>", expectedUpdatedAt: current });
        assert.equal(saved.status, 200);
        assert.match(saved.body.data.post.content, /current tab/);
    });

    it("expectedUpdatedAt alone is not a change, and must be a date", async () => {
        const post = (await create(author.token)).body.data.post;

        assert.equal((await edit(author.token, post.id, { expectedUpdatedAt: post.updatedAt })).status, 400);
        assert.equal((await edit(author.token, post.id, { content: "<p>x</p>", expectedUpdatedAt: "yesterday" })).status, 400);
    });

    it("search matches the words of a post, not its markup, attributes or links", async () => {
        const body = '<h2>Heading</h2><p>A <strong>luminous</strong> story with a <a href="https://uniquetokenxyz.example/page">link</a>.</p><pre><code class="language-javascript">const a = 1;</code></pre>';
        await create(editor.token, { title: "Findable", content: body, status: "published" });

        const total = async (q) => (await request(app).get(`/api/search?q=${encodeURIComponent(q)}`)).body.meta.pagination.total;

        assert.equal(await total("luminous"), 1);
        assert.equal(await total("heading"), 1);
        assert.equal(await total("strong"), 0, "tag names are not searchable");
        assert.equal(await total("uniquetokenxyz"), 0, "link addresses are not searchable");
        assert.equal(await total("javascript"), 0, "class names are not searchable");
    });

    it("compares revisions block by block", async () => {
        const post = (await create(author.token, { content: "<h2>Title</h2><p>One</p><p>Two</p>" })).body.data.post;
        await sql("UPDATE `post_revisions` SET createdAt = '2020-01-01 00:00:00' WHERE postId = :id", { id: post.id });
        await edit(author.token, post.id, { content: "<h2>Title</h2><p>One</p><p>Three</p>" });

        const comparison = (await request(app).get(`/api/posts/${post.id}/revisions/compare?from=1&to=2`).set(bearer(author.token))).body.data.comparison;

        assert.deepEqual(comparison.content.filter((part) => part.type === "remove").map((part) => part.value.trim()), ["Two"]);
        assert.deepEqual(comparison.content.filter((part) => part.type === "add").map((part) => part.value.trim()), ["Three"]);
        assert.deepEqual(comparison.stats, { added: 1, removed: 1 });
    });

    it("restoring a revision sanitizes it again and leaves out images that no longer exist", async () => {
        const image = await uploaded(author.token, "inline");
        const post = (await create(author.token, { content: `<p>Keep this text</p><img src="${image.url}" alt="gone soon">` })).body.data.post;
        await sql("UPDATE `post_revisions` SET createdAt = '2020-01-01 00:00:00' WHERE postId = :id", { id: post.id });
        await edit(author.token, post.id, { content: "<p>Replacement</p>" });
        assert.equal((await request(app).delete(`/api/media/${image.id}`).set(bearer(author.token))).status, 200);
        // an old revision that predates today's rules
        await sql("UPDATE `post_revisions` SET content = :html WHERE postId = :id AND version = 1", {
            id: post.id,
            html: `<p onclick="x()">Keep this text</p><script>steal()</script><img src="${image.url}">`,
        });

        const restored = await request(app).post(`/api/posts/${post.id}/revisions/1/restore`).set(bearer(author.token));

        assert.equal(restored.status, 200);
        assert.equal(restored.body.data.post.content, "<p>Keep this text</p>");
        assert.equal(restored.body.data.post.excerpt, "Keep this text");
        assert.equal(await PostMedia.count({ where: { postId: post.id } }), 0);
    });
});
