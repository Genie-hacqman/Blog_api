import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Parser } from "htmlparser2";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { makeImage } from "./imageHelpers.js";
import { Post, User } from "../database/models/index.js";
import { env } from "../config/env.js";
import { FEED_LIMIT } from "../config/seo.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const CRAWLER = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const get = (path, headers = {}) => request(app).get(path).set("User-Agent", CRAWLER).set(headers);
const createPost = (token, body = {}) => request(app).post("/api/posts").set(bearer(token)).send({ title: "A post", content: "<p>Some content for the post.</p>", ...body });
const publish = (token, body = {}) => createPost(token, { status: "published", ...body });
const move = (token, id, to) => request(app).post(`/api/posts/${id}/status`).set(bearer(token)).send({ to });
const category = (token, body) => request(app).post("/api/categories").set(bearer(token)).send(body);
const upload = async (token, purpose) =>
    (await request(app).post("/api/media").set(bearer(token)).field("purpose", purpose).attach("file", await makeImage(), { filename: "p.jpg", contentType: "image/jpeg" })).body.data.media;
const name = (account) => account.credentials.userName;

// A strict-enough XML reader for the tests: every element must be closed by its own end tag (the HTML parser
// would quietly repair anything else), and text comes back with its entities decoded.
const parseXml = (text) => {
    const root = { name: "#root", children: [], text: "" };
    const stack = [root];
    let problem = null;
    let selfClosing = false;
    const parser = new Parser(
        {
            onopentag: (tag, attributes) => {
                // `<name .../>` is closed by itself (the parser reports its end as "implied")
                selfClosing = text.slice(parser.startIndex, parser.endIndex + 1).endsWith("/>");
                const node = { name: tag, attributes, children: [], text: "" };
                stack.at(-1).children.push(node);
                stack.push(node);
            },
            ontext: (value) => {
                stack.at(-1).text += value;
            },
            onclosetag: (tag, implied) => {
                if ((implied && !selfClosing) || stack.at(-1).name !== tag) problem = `unbalanced </${tag}>`;
                selfClosing = false;
                stack.pop();
            },
            onerror: (error) => {
                problem = String(error);
            },
        },
        { xmlMode: true, decodeEntities: true },
    );
    parser.write(text);
    parser.end();
    assert.equal(problem, null, problem ?? "");
    assert.equal(stack.length, 1, "every element is closed");
    return root.children[0];
};
const all = (node, tag) => [...(node.name === tag ? [node] : []), ...node.children.flatMap((child) => all(child, tag))];
const texts = (node, tag) => all(node, tag).map((n) => n.text);

const metaOf = (html, attribute, key) => html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)">`))?.[1];
const jsonLdOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
const unescapeHtml = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

after(closeDatabase);

describe("SEO: sitemaps, robots, feeds and crawler snapshots", () => {
    const HOSTILE = `Hello <World> & "Co" </script><script>alert(1)</script>`;
    let editor;
    let other;
    let author;
    let admin;
    let techId;
    let hostile;
    let covered;
    let archived;
    let draftOnly;
    let ofSuspended;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        other = await registerAndLogin({ role: "editor" });
        author = await registerAndLogin({ role: "author" });
        admin = await registerAndLogin({ role: "admin" });

        techId = (await category(editor.token, { name: "Tech", description: 'Gadgets & "gizmos" <b>' })).body.data.category.id;
        await category(editor.token, { name: "Empty section" });

        hostile = (await publish(editor.token, { title: HOSTILE, categoryId: techId, tags: ["React", "Node JS"], content: "<p>First story body about gadgets.</p>" })).body.data.post;
        // a row stored before sanitizing existed must still never come out as markup
        await Post.update({ content: '<p>Legacy body</p><script>alert("x")</script><img src=x onerror=alert(1)>' }, { where: { id: hostile.id } });

        const cover = await upload(editor.token, "cover");
        covered = (await publish(editor.token, { title: "Covered story", coverMediaId: cover.id, coverAlt: 'A "sunrise"', content: "<p>With a picture.</p>" })).body.data.post;

        archived = (await publish(editor.token, { title: "Archived story" })).body.data.post;
        await move(editor.token, archived.id, "archived");
        draftOnly = (await createPost(editor.token, { title: "Secret draft" })).body.data.post;
        await createPost(author.token, { title: "Author draft" });
        ofSuspended = (await publish(other.token, { title: "Story of a suspended author" })).body.data.post;
        await User.update({ status: "suspended" }, { where: { id: other.user.id } });
    });

    describe("robots.txt", () => {
        it("is plain text that blocks private areas, allows the feeds and points at the sitemap", async () => {
            const response = await get("/robots.txt");
            assert.equal(response.status, 200);
            assert.match(response.headers["content-type"], /^text\/plain/);
            assert.match(response.headers["cache-control"], /public, max-age=3600/);
            for (const path of ["/api/", "/me/", "/admin", "/settings", "/posts/", "/search", "/feed$"]) assert.ok(response.text.includes(`Disallow: ${path}\n`), path);
            assert.ok(response.text.includes(`Sitemap: ${env.APP_URL}/sitemap.xml`));
            assert.ok(!/Disallow: \/blog/.test(response.text));
        });
    });

    describe("sitemaps", () => {
        it("lists the stories file and the pages file in the index", async () => {
            const response = await get("/sitemap.xml");
            assert.equal(response.status, 200);
            assert.match(response.headers["content-type"], /^application\/xml/);
            const root = parseXml(response.text);
            assert.deepEqual(texts(root, "loc"), [`${env.APP_URL}/sitemap-pages.xml`, `${env.APP_URL}/sitemap-posts-1.xml`]);
        });

        it("lists published stories only, with their last change, whoever the author is", async () => {
            const response = await get("/sitemap-posts-1.xml");
            const root = parseXml(response.text);
            const urls = texts(root, "loc");

            const stored = await Post.findAll({ attributes: ["id", "slug", "status", "updatedAt"], raw: true });
            const published = stored.filter((post) => post.status === "published");
            assert.deepEqual([...urls].sort(), published.map((post) => `${env.APP_URL}/blog/${post.slug}`).sort());
            assert.ok(urls.includes(`${env.APP_URL}/blog/${ofSuspended.slug}`), "a story stays public when its author is suspended");
            for (const hidden of [archived, draftOnly]) assert.ok(!urls.some((url) => url.endsWith(`/${hidden.slug}`)), hidden.slug);
            for (const post of published) {
                const entry = all(root, "url").find((node) => node.children[0].text.endsWith(`/blog/${post.slug}`));
                assert.equal(entry.children[1].text, new Date(post.updatedAt).toISOString());
            }
        });

        it("lists the front page and only the sections, topics and authors that have something published", async () => {
            const urls = texts(parseXml((await get("/sitemap-pages.xml")).text), "loc");

            assert.ok(urls.includes(`${env.APP_URL}/`));
            assert.ok(urls.includes(`${env.APP_URL}/category/tech`));
            assert.ok(!urls.some((url) => url.includes("empty-section")), "an empty section is left out");
            assert.ok(urls.includes(`${env.APP_URL}/tag/react`) && urls.includes(`${env.APP_URL}/tag/node-js`));
            assert.ok(urls.includes(`${env.APP_URL}/u/${name(editor)}`));
            assert.ok(!urls.some((url) => url.endsWith(`/u/${name(author)}`)), "an author with nothing published is left out");
            assert.ok(!urls.some((url) => url.endsWith(`/u/${name(other)}`)), "a suspended author has no public profile");
        });

        it("answers 404 for a file that does not exist", async () => {
            for (const path of ["/sitemap-posts-2.xml", "/sitemap-posts-0.xml", "/sitemap-posts-abc.xml", "/sitemap-posts-1.5.xml"]) {
                assert.equal((await get(path)).status, 404, path);
            }
        });

        it("can be cached: it carries an ETag and answers 304 when nothing changed", async () => {
            const first = await get("/sitemap.xml");
            assert.ok(first.headers.etag);
            assert.match(first.headers["cache-control"], /public, max-age=3600, s-maxage=3600/);
            assert.equal((await get("/sitemap.xml", { "If-None-Match": first.headers.etag })).status, 304);
        });
    });

    describe("feeds", () => {
        it("is valid RSS with the newest story first, and the sanitized body", async () => {
            const response = await get("/feed.xml");
            assert.equal(response.status, 200);
            assert.match(response.headers["content-type"], /^application\/rss\+xml/);
            const rss = parseXml(response.text);
            const items = all(rss, "item");

            assert.deepEqual(
                items.map((item) => texts(item, "title")[0]),
                [ofSuspended.title, covered.title, HOSTILE],
            );
            assert.equal(texts(rss, "link")[0], `${env.APP_URL}/`);
            const hostileItem = items.find((item) => texts(item, "title")[0] === HOSTILE);
            const body = texts(hostileItem, "content:encoded")[0];
            assert.match(body, /<p>Legacy body<\/p>/);
            assert.ok(!/<script|onerror/i.test(body), body);
            assert.deepEqual(texts(hostileItem, "category").sort(), ["Node JS", "React", "Tech"]);
            assert.equal(texts(hostileItem, "guid")[0], `${env.APP_URL}/blog/${hostile.slug}`);
            assert.ok(!response.text.includes(editor.credentials.email));
        });

        it("has one feed per author, section and topic, and 404 for the unknown", async () => {
            const byAuthor = all(parseXml((await get(`/feed/author/${name(editor)}.xml`)).text), "item");
            assert.equal(byAuthor.length, 2, "the archived story is not in it");
            assert.equal(all(parseXml((await get("/feed/category/tech.xml")).text), "item").length, 1);
            assert.equal(all(parseXml((await get("/feed/tag/react.xml")).text), "item").length, 1);

            // unknown, suspended (no public profile), no .xml, unknown section, unknown topic
            for (const path of ["/feed/author/nobody.xml", `/feed/author/${name(other)}.xml`, `/feed/author/${name(editor)}`, "/feed/category/nope.xml", "/feed/tag/nope.xml"]) {
                assert.equal((await get(path)).status, 404, path);
            }
            assert.equal(all(parseXml((await get(`/feed/author/${name(author)}.xml`)).text), "item").length, 0, "an active author with nothing published has an empty feed");
        });

        it("never lists more than the feed limit", async () => {
            for (let i = 0; i < FEED_LIMIT + 2; i += 1) await publish(admin.token, { title: `Bulk story ${i}` });
            assert.equal(all(parseXml((await get("/feed.xml")).text), "item").length, FEED_LIMIT);
        });
    });

    describe("story snapshots", () => {
        it("describes a story completely, and escapes what it was given", async () => {
            const response = await get(`/api/seo/blog/${hostile.slug}`);
            const html = response.text;

            assert.equal(response.status, 200);
            assert.match(response.headers["content-type"], /^text\/html/);
            assert.match(response.headers["cache-control"], /public, max-age=300/);
            const escapedTitle = "Hello &lt;World&gt; &amp; &quot;Co&quot; &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;";
            assert.ok(html.includes(`<title>${escapedTitle} — ${env.SITE_NAME}</title>`.replace("'", "&#39;")));
            assert.ok(html.includes(`<h1>${escapedTitle}</h1>`));
            assert.equal(metaOf(html, "property", "og:type"), "article");
            assert.equal(unescapeHtml(metaOf(html, "property", "og:title")), HOSTILE);
            assert.equal(metaOf(html, "property", "og:url"), `${env.APP_URL}/blog/${hostile.slug}`);
            assert.ok(html.includes(`<link rel="canonical" href="${env.APP_URL}/blog/${hostile.slug}">`));
            assert.equal(metaOf(html, "name", "robots"), "index,follow");
            assert.equal(metaOf(html, "name", "twitter:card"), "summary_large_image");
            assert.match(metaOf(html, "property", "og:image"), /\/og-default\.png$/);
            assert.ok(metaOf(html, "property", "article:published_time"));
            assert.deepEqual(
                [...html.matchAll(/<meta property="article:tag" content="([^"]*)">/g)].map((m) => m[1]).sort(),
                ["Node JS", "React"],
            );
            assert.match(html, /<p>Legacy body<\/p>/);
            assert.ok(!/<script>alert|onerror/i.test(html), "the stored script never comes out");
            assert.equal(html.match(/<script/g).length, 1, "only the JSON-LD data block");
            assert.ok(!html.includes(editor.credentials.email), "no email address");
        });

        it("has JSON-LD that parses and matches the story", async () => {
            const graph = jsonLdOf((await get(`/api/seo/blog/${hostile.slug}`)).text)["@graph"];
            const posting = graph.find((node) => node["@type"] === "BlogPosting");
            const trail = graph.find((node) => node["@type"] === "BreadcrumbList");

            assert.equal(posting.headline, HOSTILE);
            assert.equal(posting.author.name, name(editor));
            assert.equal(posting.author.url, `${env.APP_URL}/u/${name(editor)}`);
            assert.equal(posting.articleSection, "Tech");
            assert.deepEqual(posting.keywords.split(", ").sort(), ["Node JS", "React"]);
            assert.equal(posting.mainEntityOfPage, `${env.APP_URL}/blog/${hostile.slug}`);
            assert.ok(posting.datePublished && posting.dateModified);
            assert.deepEqual(trail.itemListElement.map((item) => item.position), [1, 2, 3]);
            assert.equal(trail.itemListElement[1].item, `${env.APP_URL}/category/tech`);
        });

        it("uses the cover as an absolute address, with its description as alternative text", async () => {
            const html = (await get(`/api/seo/blog/${covered.slug}`)).text;
            const image = metaOf(html, "property", "og:image");

            assert.match(image, new RegExp(`^${env.APP_URL.replace(/[.]/g, "\\.")}/media/u/${editor.user.id}/[0-9a-f-]+\\.webp$|^https?://`));
            assert.equal(metaOf(html, "name", "twitter:image"), image);
            assert.equal(metaOf(html, "property", "og:image:alt"), "A &quot;sunrise&quot;");
            assert.ok(html.includes(`<img src="${image}" alt="A &quot;sunrise&quot;">`));
            assert.deepEqual(jsonLdOf(html)["@graph"][0].image, [image]);
        });

        it("serves a story whose author was suspended, like the public API does", async () => {
            assert.equal((await get(`/api/seo/blog/${ofSuspended.slug}`)).status, 200);
            assert.equal((await request(app).get(`/api/posts/slug/${ofSuspended.slug}`)).status, 200);
        });

        it("answers the same real 404 for everything that is not public", async () => {
            const missing = await get("/api/seo/blog/no-such-story");
            assert.equal(missing.status, 404);
            assert.equal(missing.headers["x-robots-tag"], "noindex");
            assert.match(missing.text, /<meta name="robots" content="noindex,nofollow">/);

            for (const slug of [archived.slug, draftOnly.slug, "no-such-story"].filter(Boolean)) {
                const response = await get(`/api/seo/blog/${slug}`);
                assert.equal(response.status, 404, slug);
                assert.equal(response.text, missing.text, "the page does not say why");
            }
        });
    });

    describe("list snapshots", () => {
        it("lists the front page with real links, a canonical address and paging", async () => {
            const first = await get("/api/seo/home");
            assert.equal(first.status, 200);
            assert.ok(first.text.includes(`<link rel="canonical" href="${env.APP_URL}/">`));
            assert.match(first.text, new RegExp(`<a href="${env.APP_URL}/blog/[a-z0-9-]+">`));
            assert.ok(first.text.includes(`<link rel="next" href="${env.APP_URL}/?page=2">`));
            assert.ok(!first.text.includes('rel="prev"'));
            assert.ok(!first.text.includes("Secret draft") && !first.text.includes("Archived story"));
            assert.equal(jsonLdOf(first.text)["@graph"].find((node) => node["@type"] === "WebSite").name, env.SITE_NAME);

            const second = await get("/api/seo/home?page=2");
            assert.ok(second.text.includes(`<link rel="canonical" href="${env.APP_URL}/?page=2">`));
            assert.ok(second.text.includes(`<link rel="prev" href="${env.APP_URL}/">`));
        });

        it("answers 404 for a page past the last, and treats a junk page number as the first", async () => {
            assert.equal((await get("/api/seo/home?page=999")).status, 404);
            assert.equal((await get("/api/seo/home?page=abc")).status, 200);
            assert.equal((await get("/api/seo/home?page=-3")).status, 200);
        });

        it("describes a section and a topic, and noindexes an empty section but still answers", async () => {
            const tech = await get("/api/seo/category/tech");
            assert.equal(tech.status, 200);
            assert.equal(metaOf(tech.text, "name", "robots"), "index,follow");
            assert.equal(unescapeHtml(metaOf(tech.text, "name", "description")), 'Gadgets & "gizmos" <b>');
            assert.ok(tech.text.includes(`/blog/${hostile.slug}`));

            const tag = await get("/api/seo/tag/react");
            assert.equal(tag.status, 200);
            assert.ok(tag.text.includes(`/blog/${hostile.slug}`));

            const empty = await get("/api/seo/category/empty-section");
            assert.equal(empty.status, 200);
            assert.equal(metaOf(empty.text, "name", "robots"), "noindex,follow");
            assert.equal(empty.headers["x-robots-tag"], "noindex");

            assert.equal((await get("/api/seo/category/nope")).status, 404);
            assert.equal((await get("/api/seo/tag/nope")).status, 404);
        });

        it("shows a profile of an active author, noindexes one with no stories, and hides the rest", async () => {
            await request(app).patch("/api/users/me").set(bearer(editor.token)).send({ bio: 'Writes about <b>gadgets</b> & "more"', socialLinks: { github: "https://github.com/someone" } });
            const profile = await get(`/api/seo/u/${name(editor)}`);
            assert.equal(profile.status, 200);
            assert.equal(metaOf(profile.text, "property", "og:type"), "profile");
            assert.equal(unescapeHtml(metaOf(profile.text, "name", "description")), 'Writes about <b>gadgets</b> & "more"');
            assert.ok(!profile.text.includes("<b>gadgets</b>"));
            const person = jsonLdOf(profile.text)["@graph"].find((node) => node["@type"] === "Person");
            assert.deepEqual(person.sameAs, ["https://github.com/someone"]);
            assert.ok(!profile.text.includes(editor.credentials.email));

            const quiet = await get(`/api/seo/u/${name(author)}`);
            assert.equal(quiet.status, 200);
            assert.equal(metaOf(quiet.text, "name", "robots"), "noindex,follow");

            assert.equal((await get(`/api/seo/u/${name(other)}`)).status, 404, "suspended");
            assert.equal((await get("/api/seo/u/nobody")).status, 404);
            await User.update({ status: "deleted" }, { where: { id: author.user.id } });
            assert.equal((await get(`/api/seo/u/${name(author)}`)).status, 404, "deleted");
            await User.update({ status: "active" }, { where: { id: author.user.id } });
        });
    });

    describe("the switch and the cost", () => {
        it("answers 404 to everything when SEO_ENABLED is false", async () => {
            env.SEO_ENABLED = false;
            try {
                for (const path of ["/robots.txt", "/sitemap.xml", "/sitemap-pages.xml", "/sitemap-posts-1.xml", "/feed.xml", `/api/seo/blog/${hostile.slug}`, "/api/seo/home"]) {
                    assert.equal((await get(path)).status, 404, path);
                }
            } finally {
                env.SEO_ENABLED = true;
            }
            assert.equal((await get("/robots.txt")).status, 200);
        });

        it("asks the database the same number of questions for a short list as for a long one", async () => {
            const countQueries = async (path) => {
                let queries = 0;
                const count = () => {
                    queries += 1;
                };
                sequelize.addHook("beforeQuery", count);
                try {
                    assert.equal((await get(path)).status, 200);
                } finally {
                    sequelize.removeHook("beforeQuery", count);
                }
                return queries;
            };

            for (const path of ["/feed.xml", "/feed/category/tech.xml", "/api/seo/home", "/sitemap-posts-1.xml", "/sitemap-pages.xml"]) {
                const first = await countQueries(path);
                await publish(admin.token, { title: `Extra story for ${path}`, categoryId: techId, tags: ["react"] });
                assert.equal(await countQueries(path), first, path);
            }
        });
    });
});
