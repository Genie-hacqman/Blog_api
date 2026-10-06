import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { Category, Post } from "../database/models/index.js";
import { setSearchProviderForTests } from "../providers/search/index.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const search = (q, extra = "") => request(app).get(`/api/search?q=${encodeURIComponent(q)}${extra}`);
const titles = (response) => {
    // a failed search should say why, not just "undefined"
    assert.ok(response.body.data, `search failed with ${response.status}: ${JSON.stringify(response.body)}`);
    return response.body.data.posts.map((post) => post.title);
};

after(closeDatabase);

describe("search", () => {
    let ed;
    let zelda;
    let author;
    const ids = {};

    const make = async (owner, title, content, extra = {}) => {
        const response = await request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content, ...extra });
        assert.equal(response.status, 201, `${title}: ${JSON.stringify(response.body)}`);
        return response.body.data.post;
    };
    const publish = async (owner, title, content, extra = {}) => make(owner, title, content, { status: "published", ...extra });

    before(resetDatabase);
    before(async () => {
        ed = await registerAndLogin({ role: "editor", userName: "ed_writer" });
        zelda = await registerAndLogin({ role: "editor", userName: "zelda_writer" });
        author = await registerAndLogin({ role: "author", userName: "plain_author" });

        ids.a = (await publish(ed, "Learning React hooks", "State management basics for beginners.", { tags: ["JavaScript"] })).id;
        ids.b = (await publish(ed, "Gardening notes", "A short note that mentions react once in passing, plus tomatoes.")).id;
        ids.c = (await publish(ed, "Café Müller", "Pastries and coffee.", { excerpt: "A unicorn of a bakery." })).id;
        ids.d = (await publish(ed, "Weekend reading", "Nothing relevant here.", { tags: ["Rust", "Node JS"] })).id;
        ids.e = (await publish(zelda, "Speedrun records", "Fast runs of classic games.")).id;
        ids.f = (await publish(ed, "JS tips", "Small tricks.")).id;
        ids.g = (await publish(ed, "Go_lang tips", "More tricks.")).id;
        ids.h = (await publish(ed, "Gone fishing", "Lakes and rivers.")).id;

        // posts that mention react but are not published: they must never appear
        ids.draft = (await make(ed, "Secret react draft", "react react react")).id;
        ids.pending = (await make(author, "Pending react post", "react in review")).id;
        await request(app).post(`/api/posts/${ids.pending}/status`).set(bearer(author.token)).send({ to: "pending_review" });
        for (const [key, status] of [["scheduled", "scheduled"], ["rejected", "rejected"], ["archived", "archived"], ["private", "private"]]) {
            ids[key] = (await make(ed, `Hidden react ${key}`, "react content")).id;
            await Post.update({ status, scheduledAt: status === "scheduled" ? new Date(Date.now() + 3600_000) : null }, { where: { id: ids[key] } });
        }
    });

    describe("what it finds", () => {
        it("ranks a title match above a body match", async () => {
            const response = await search("react");

            assert.equal(response.status, 200);
            assert.deepEqual(titles(response), ["Learning React hooks", "Gardening notes"]);
        });

        it("finds posts by their content", async () => {
            assert.deepEqual(titles(await search("tomatoes")), ["Gardening notes"]);
        });

        it("finds posts by their excerpt", async () => {
            assert.deepEqual(titles(await search("unicorn")), ["Café Müller"]);
        });

        it("finds posts by their tags even when the text never mentions the word", async () => {
            assert.deepEqual(titles(await search("rust")), ["Weekend reading"]);
            assert.deepEqual(titles(await search("RUST")), ["Weekend reading"]);
            assert.deepEqual(titles(await search("node js")), ["Weekend reading"], "a multi-word tag is found by its whole name");
        });

        it("finds posts by their author's username, underscores included", async () => {
            assert.deepEqual(titles(await search("zelda_writer")), ["Speedrun records"]);
        });

        it("ignores case and accents", async () => {
            assert.deepEqual(titles(await search("cafe")), ["Café Müller"]);
            assert.deepEqual(titles(await search("MULLER")), ["Café Müller"]);
            assert.deepEqual(titles(await search("café")), ["Café Müller"]);
        });

        it("finds nothing, without an error, for words that are not there or are too common to index", async () => {
            const missing = await search("xylophone");
            assert.equal(missing.status, 200);
            assert.deepEqual(missing.body.data.posts, []);
            assert.equal(missing.body.meta.pagination.total, 0);
            assert.equal((await search("the")).status, 200, "a stopword is not an error");
        });

        it("finds short words such as 'js' by title", async () => {
            assert.deepEqual(titles(await search("js")), ["JS tips"]);
        });

        it("treats % and _ in a short query as ordinary characters", async () => {
            // "go_" means the letters g, o, underscore; unescaped, _ would match any character and find "Gone fishing" too
            assert.deepEqual(titles(await search("go_")), ["Go_lang tips"]);
        });
    });

    describe("what it never shows", () => {
        it("excludes drafts, posts in review, scheduled, rejected, archived and private posts", async () => {
            const response = await search("react");
            const found = response.body.data.posts.map((post) => post.id);

            for (const hidden of ["draft", "pending", "scheduled", "rejected", "archived", "private"]) {
                assert.ok(!found.includes(ids[hidden]), `a ${hidden} post must not be searchable`);
            }
            assert.equal(response.body.meta.pagination.total, 2);
        });

        it("reflects changes as soon as they are saved: edits are found, unpublished posts disappear, republished ones return", async () => {
            await request(app).patch(`/api/posts/${ids.b}`).set(bearer(ed.token)).send({ content: "Now it talks about a zebra." });
            assert.deepEqual(titles(await search("zebra")), ["Gardening notes"]);
            assert.deepEqual(titles(await search("tomatoes")), [], "the old text is no longer indexed");

            await request(app).post(`/api/posts/${ids.b}/status`).set(bearer(ed.token)).send({ to: "draft" });
            assert.deepEqual(titles(await search("zebra")), []);

            await request(app).post(`/api/posts/${ids.b}/status`).set(bearer(ed.token)).send({ to: "published" });
            assert.deepEqual(titles(await search("zebra")), ["Gardening notes"]);

            await request(app).patch(`/api/posts/${ids.b}`).set(bearer(ed.token)).send({ content: "A short note that mentions react once in passing, plus tomatoes." });
        });

        it("still finds a deleted author's posts by their words, but not by their old username", async () => {
            const leaver = await registerAndLogin({ role: "editor", userName: "leaver_one" });
            await publish(leaver, "Remembered", "Stories about quokkas.");
            assert.equal((await search("leaver_one")).body.data.posts.length, 1, "found by username while the account exists");

            await request(app).delete("/api/users/me").set(bearer(leaver.token)).send({ password: leaver.credentials.password });

            const byWords = await search("quokkas");
            assert.deepEqual(titles(byWords), ["Remembered"]);
            assert.equal(byWords.body.data.posts[0].author.username, "Deleted user");
            assert.deepEqual((await search("leaver_one")).body.data.posts, []);
        });
    });

    describe("hostile and odd input", () => {
        it("never errors or injects, whatever is typed", async () => {
            const before = await Post.count();
            const attempts = [
                '"react" -hooks +state*',
                "react) OR 1=1 --",
                "'; DROP TABLE Posts; --",
                "react' AND '1'='1",
                "@@version",
                "react\\",
                "react %",
                "(react)",
                "react <b>bold</b>",
                "react ~tilde",
                "😀 react",
                "react\u0000null",
                "\n\treact\n",
                "UNION SELECT password FROM Users",
            ];
            for (const q of attempts) {
                const response = await search(q);
                assert.ok([200, 400].includes(response.status), `${JSON.stringify(q)} gave ${response.status}`);
                // (meta.query echoes what the caller typed, so only the results are checked for leaked data)
                assert.ok(!JSON.stringify(response.body.data ?? {}).includes("password"), "no user data can leak");
                if (response.status === 200) assert.ok(response.body.data.posts.every((post) => !("content" in post)));
            }
            assert.equal(await Post.count(), before, "nothing was dropped or changed");
        });

        it("returns the same results for react with or without search syntax around it", async () => {
            const plain = titles(await search("react"));
            assert.deepEqual(titles(await search('"react"')), plain);
            assert.deepEqual(titles(await search("+react*")), plain);
            assert.deepEqual(titles(await search("(react)")), plain);
        });

        it("requires a real query", async () => {
            for (const url of ["/api/search", "/api/search?q=", "/api/search?q=%20%20", "/api/search?q=a", "/api/search?q=%2B%2B%2B", "/api/search?q=%25", `/api/search?q=${"a".repeat(300)}`, "/api/search?q=a&q=b"]) {
                const response = await request(app).get(url);
                assert.equal(response.status, 400, `${url.slice(0, 40)} should be a 400`);
                assert.equal(response.body.error.code, "VALIDATION_ERROR");
            }
        });

        it("caps long queries and many words instead of failing", async () => {
            const long = await search("react ".repeat(25)); // 150 characters: over the 100 kept, under the 200 accepted
            assert.equal(long.status, 200);
            assert.ok(long.body.meta.query.length <= 100, "only the first 100 characters are used");
            assert.equal((await search(Array.from({ length: 30 }, (_, i) => `word${i}`).join(" "))).status, 200);
            const echoed = await search(`  react    hooks  `);
            assert.equal(echoed.body.meta.query, "react hooks", "the tidied query is echoed back");
        });
    });

    describe("filters, order and paging", () => {
        it("narrows by category and by tag, and 404s for unknown ones", async () => {
            const category = await Category.create({ name: "Dev", slug: "dev" });
            await Post.update({ categoryId: category.id }, { where: { id: ids.a } });

            assert.deepEqual(titles(await search("react", "&category=dev")), ["Learning React hooks"]);
            assert.deepEqual(titles(await search("react", "&tag=javascript")), ["Learning React hooks"]);
            assert.deepEqual(titles(await search("react", "&category=dev&tag=rust")), []);
            assert.equal((await search("react", "&category=nope")).status, 404);
            assert.equal((await search("react", "&tag=nope")).status, 404);
            assert.equal((await search("react", "&category=Bad_Slug")).status, 400);
        });

        it("sorts by relevance by default, or by newest", async () => {
            await Post.update({ publishedAt: new Date("2025-01-01T00:00:00Z") }, { where: { id: ids.a } });
            await Post.update({ publishedAt: new Date("2026-01-01T00:00:00Z") }, { where: { id: ids.b } });

            assert.deepEqual(titles(await search("react")), ["Learning React hooks", "Gardening notes"]);
            assert.deepEqual(titles(await search("react", "&sort=newest")), ["Gardening notes", "Learning React hooks"]);
            assert.equal((await search("react", "&sort=random")).status, 400);
        });

        it("pages the results and reports the total", async () => {
            for (let i = 1; i <= 12; i += 1) await publish(ed, `Pagination probe ${i}`, "Words about pagination probes.");

            const page3 = await search("pagination", "&limit=5&page=3");

            assert.equal(page3.body.data.posts.length, 2);
            assert.deepEqual(page3.body.meta.pagination, { page: 3, limit: 5, total: 12, totalPages: 3 });
        });

        it("will not page absurdly deep", async () => {
            const response = await search("react", "&page=100000");

            assert.equal(response.status, 200);
            assert.equal(response.body.meta.pagination.page, 100);
        });

        it("returns previews: no body, with author, category and tags", async () => {
            const [first] = (await search("react", "&category=dev")).body.data.posts;

            assert.ok(!("content" in first));
            assert.equal(first.author.username, "ed_writer");
            assert.equal(first.category.slug, "dev");
            assert.deepEqual(first.tags, [{ name: "JavaScript", slug: "javascript" }]);
            assert.ok(first.slug && first.excerpt && first.publishedAt);
        });

        it("needs no login", async () => {
            assert.equal((await request(app).get("/api/search?q=react")).status, 200);
        });
    });

    describe("the engine behind it", () => {
        it("takes ids from whatever engine is configured, keeps its order, and drops anything not published", async () => {
            // a stand-in for a dedicated engine whose index is a little stale: it still lists a draft and a post that no longer exists
            setSearchProviderForTests({
                name: "stub",
                search: async () => ({ ids: [ids.b, ids.draft, ids.a, 999999, ids.private], total: 5 }),
            });
            try {
                const response = await search("anything at all");

                assert.deepEqual(titles(response), ["Gardening notes", "Learning React hooks"]);
                assert.equal(response.body.meta.pagination.total, 5, "the engine's own total is reported");
            } finally {
                setSearchProviderForTests(undefined);
            }
            assert.deepEqual(titles(await search("react")), ["Learning React hooks", "Gardening notes"], "the real engine is back");
        });

        it("hands the engine a validated question, never raw input", async () => {
            let received;
            setSearchProviderForTests({
                search: async (question) => {
                    received = question;
                    return { ids: [], total: 0 };
                },
            });
            try {
                await search('  "Node JS" -hooks %  ', "&sort=newest&page=2&limit=7");
            } finally {
                setSearchProviderForTests(undefined);
            }

            assert.deepEqual(received.terms, ["node", "js", "hooks"]);
            assert.equal(received.query, '"Node JS" -hooks %');
            assert.deepEqual([received.sort, received.limit, received.offset], ["newest", 7, 7]);
            // every word is a possible tag, and so is the whole phrase
            assert.deepEqual(received.tagSlugs, ["node", "js", "hooks", "node-js-hooks"]);
        });
    });
});
