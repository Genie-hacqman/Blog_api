import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAutoSlug, slugify, withSuffix } from "../../utils/slug.js";
import { autoExcerpt, readingTimeOf, wordCount } from "../../utils/text.js";
import { MAX_EXCERPT_LENGTH, MAX_SLUG_LENGTH, SLUG_PATTERN } from "../../config/posts.js";

describe("slugify", () => {
    it("makes clean lowercase hyphenated URLs", () => {
        assert.equal(slugify("How to Build JWT Authentication"), "how-to-build-jwt-authentication");
        assert.equal(slugify("  Hello,   World!!  "), "hello-world");
        assert.equal(slugify("C++ & Rust: a (short) comparison"), "c-rust-a-short-comparison");
    });

    it("folds accents and drops what cannot go in a URL", () => {
        assert.equal(slugify("Café Müller à la crème"), "cafe-muller-a-la-creme");
        assert.equal(slugify("Ünïcödé"), "unicode");
    });

    it("never returns an empty slug", () => {
        for (const title of ["!!!", "日本語", "   ", "", null, undefined, "😀😀"]) {
            assert.equal(slugify(title), "post", `${JSON.stringify(title)} should fall back to "post"`);
        }
    });

    it("stays within the length limit, with room for a collision suffix, and does not end in a hyphen", () => {
        const slug = slugify(`${"word ".repeat(60)}end`);

        assert.ok(slug.length <= MAX_SLUG_LENGTH - 8);
        assert.ok(!slug.endsWith("-"));
        assert.match(slug, SLUG_PATTERN);
    });

    it("always produces something that passes the slug pattern", () => {
        for (const title of ["a", "A-B", "--x--", "1 2 3", "tab\tand\nnewline", "Ω≈ç√∫", "<script>alert(1)</script>", "../../etc/passwd"]) {
            assert.match(slugify(title), SLUG_PATTERN, `${JSON.stringify(title)} -> ${slugify(title)}`);
        }
    });

    it("numbers collisions", () => {
        assert.equal(withSuffix("post", 1), "post");
        assert.equal(withSuffix("post", 2), "post-2");
        assert.equal(withSuffix("post", 10), "post-10");
    });
});

describe("isAutoSlug", () => {
    it("recognizes slugs generated from the title, with or without a collision number", () => {
        assert.equal(isAutoSlug("my-title", "My Title"), true);
        assert.equal(isAutoSlug("my-title-3", "My Title"), true);
    });

    it("treats anything else as chosen by the author", () => {
        assert.equal(isAutoSlug("custom-url", "My Title"), false);
        assert.equal(isAutoSlug("my-title-extra", "My Title"), false);
        assert.equal(isAutoSlug("my-title-3-x", "My Title"), false);
    });
});

describe("text helpers", () => {
    it("leaves short content alone and trims it", () => {
        assert.equal(autoExcerpt("  Short and sweet.  "), "Short and sweet.");
    });

    it("cuts long content so the excerpt, ellipsis included, fits the column", () => {
        const excerpt = autoExcerpt("é".repeat(5000));

        assert.equal(excerpt.length, MAX_EXCERPT_LENGTH);
        assert.ok(excerpt.endsWith("…"));
    });

    it("counts words and estimates reading time at 225 words a minute, never below one", () => {
        assert.equal(wordCount("  one   two\nthree  "), 3);
        assert.equal(readingTimeOf(""), 1);
        assert.equal(readingTimeOf("word ".repeat(225)), 1);
        assert.equal(readingTimeOf("word ".repeat(450)), 2);
        assert.equal(readingTimeOf("word ".repeat(2250)), 10);
    });
});
