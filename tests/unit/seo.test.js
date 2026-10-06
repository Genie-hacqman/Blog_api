import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env } from "../../config/env.js";
import { DISALLOWED_PATHS } from "../../config/seo.js";
import { absoluteUrl, describe as describeText, escapeHtml, jsonLdScript } from "../../utils/seoHtml.js";
import { emptyElement, escapeXml, groupElement, textElement } from "../../utils/xml.js";
import { robotsTxt } from "../../services/seoService.js";
import { renderNotFound, renderSnapshot } from "../../views/snapshot.js";

describe("escaping HTML", () => {
    it("escapes the five characters that can leave a text or an attribute", () => {
        assert.equal(escapeHtml(`<a href="x" onclick='y'>&</a>`), "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
        assert.equal(escapeHtml(null), "");
        assert.equal(escapeHtml(42), "42");
    });
});

describe("escaping XML", () => {
    it("escapes markup characters and drops characters XML cannot hold", () => {
        assert.equal(escapeXml(`a & b < c > "d" 'e'`), "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;");
        assert.equal(escapeXml("bell\u0007 null\u0000 ok\tline\n"), "bell null ok\tline\n");
        assert.equal(escapeXml("lone \ud800 surrogate"), "lone  surrogate");
        assert.equal(escapeXml("emoji 🎉 and ünï"), "emoji 🎉 and ünï");
    });

    it("builds elements whose text and attributes are escaped", () => {
        assert.equal(textElement("title", "a<b", { lang: 'e"n' }), '<title lang="e&quot;n">a&lt;b</title>');
        assert.equal(emptyElement("atom:link", { href: "https://x/?a=1&b=2" }), '<atom:link href="https://x/?a=1&amp;b=2"/>');
        assert.equal(groupElement("a", ["<b/>", "<c/>"]), "<a><b/><c/></a>");
    });
});

describe("JSON-LD", () => {
    it("cannot be closed early, and reads back as the same data", () => {
        const data = { name: "</script><script>alert(1)</script>", other: "a & b > c \u2028 \u2029" };
        const html = jsonLdScript(data);

        assert.equal(html.match(/<\/script/gi).length, 1, "only the closing tag of the block itself");
        assert.ok(!html.includes("<script>alert"));
        assert.ok(!html.includes("\u2028") && !html.includes("\u2029"));
        const json = html.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, "");
        assert.deepEqual(JSON.parse(json), data);
    });
});

describe("absoluteUrl", () => {
    it("keeps http(s) addresses, roots site-relative ones at APP_URL and refuses everything else", () => {
        assert.equal(absoluteUrl("https://cdn.example.com/a.webp"), "https://cdn.example.com/a.webp");
        assert.equal(absoluteUrl("/media/u/1/a.webp"), `${env.APP_URL}/media/u/1/a.webp`);
        for (const bad of ["//evil.example/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "ftp://x/y", "", null, undefined, "not a url"]) {
            assert.equal(absoluteUrl(bad), null, String(bad));
        }
    });
});

describe("descriptions", () => {
    it("leaves short text alone and cuts long text at a word with an ellipsis", () => {
        assert.equal(describeText("  A short   line\nof text "), "A short line of text");
        const long = "word ".repeat(80);
        const cut = describeText(long);
        assert.ok(cut.length <= 160);
        assert.ok(cut.endsWith("word…"), cut);
        assert.equal(describeText("x".repeat(400)).length, 160);
    });
});

describe("robots.txt", () => {
    it("keeps private areas out, names the sitemap and allows the feeds", () => {
        const text = robotsTxt();
        for (const path of DISALLOWED_PATHS) assert.ok(text.includes(`Disallow: ${path}\n`), path);
        assert.ok(text.includes(`Sitemap: ${env.APP_URL}/sitemap.xml`));
        assert.ok(text.startsWith("User-agent: *\n"));
        assert.ok(!/Disallow: \/(feed)?\n/.test(text), "nothing blocks the whole site or every feed");
        assert.ok(DISALLOWED_PATHS.includes("/feed$"), "the signed-in /feed page is blocked without blocking /feed.xml");
    });
});

describe("the snapshot page", () => {
    const base = { title: 'T <i>"x"</i>', description: 'd "q" <b>', canonical: "https://example.com/blog/a?x=1&y=2", bodyHtml: "<p>body</p>" };

    it("escapes every value it is given and has no script but the data block", () => {
        const html = renderSnapshot({ ...base, image: 'https://example.com/i.png"onload="x', article: { published: "p", modified: "m", authorUrl: "https://a", tags: ['t"1'] }, jsonLd: { a: "</script>" } });

        assert.ok(!html.includes("<i>"));
        assert.ok(!html.includes('"onload="x'));
        assert.match(html, /<title>T &lt;i&gt;&quot;x&quot;&lt;\/i&gt; — /);
        assert.match(html, /<link rel="canonical" href="https:\/\/example\.com\/blog\/a\?x=1&amp;y=2">/);
        assert.equal(html.match(/<script/g).length, 1);
        assert.ok(!/ style=|<style/.test(html));
        assert.match(html, /<meta property="article:tag" content="t&quot;1">/);
    });

    it("uses the default picture and a large card when there is no picture, and says noindex when told to", () => {
        const html = renderSnapshot({ ...base, robots: "noindex,follow" });
        assert.match(html, /<meta property="og:image" content="[^"]+\/og-default\.png">/);
        assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
        assert.match(html, /<meta name="robots" content="noindex,follow">/);
    });

    it("the not-found page is noindex and reveals nothing", () => {
        const html = renderNotFound();
        assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
        assert.match(html, /<h1>Page not found<\/h1>/);
    });
});
