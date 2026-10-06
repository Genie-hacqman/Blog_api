import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asciiSlug, prepareTags, tidyName } from "../../utils/taxonomy.js";
import { escapeLike, extractTerms, needsTitleFallback, normalizeQuery, tagSlugsFor, usernameCandidates } from "../../utils/searchQuery.js";

describe("tag names", () => {
    it("tidies whitespace", () => {
        assert.equal(tidyName("  Node   JS \n"), "Node JS");
        assert.equal(tidyName(null), "");
    });

    it("turns names into ASCII slugs, and refuses names that would have none", () => {
        assert.equal(asciiSlug("Node JS"), "node-js");
        assert.equal(asciiSlug("Café"), "cafe");
        assert.equal(asciiSlug("日本語"), null);
        assert.equal(asciiSlug("---"), null);
        assert.equal(asciiSlug("C++"), "c");
    });

    it("merges names that differ only by case, accents or spacing, keeping the first spelling", () => {
        const tags = prepareTags(["React", " react ", "REACT", "Café", "cafe", "Node  JS"]);

        assert.deepEqual(tags, [
            { name: "React", slug: "react" },
            { name: "Café", slug: "cafe" },
            { name: "Node JS", slug: "node-js" },
        ]);
    });

    it("rejects names that are too short, too long, or use other characters", () => {
        for (const bad of ["a", "x".repeat(31), "c++", "tag!", "hash#tag", "under_score", "dot.dot", "-leading", "trailing-", "two--hyphens", "日本語", "😀😀"]) {
            assert.throws(() => prepareTags([bad]), { name: "ValidationError" }, `${JSON.stringify(bad)} should be rejected`);
        }
    });

    it("accepts letters, digits, single spaces and hyphens", () => {
        assert.deepEqual(prepareTags(["web-3", "Go 2", "ai"]).map((tag) => tag.slug), ["web-3", "go-2", "ai"]);
    });

    it("names the problem in the error", () => {
        assert.throws(() => prepareTags(["bad!"]), /can only contain letters, numbers, spaces and hyphens/);
        assert.throws(() => prepareTags(["x"]), /2 to 30 characters/);
    });
});

describe("search queries", () => {
    it("tidies and caps what was typed", () => {
        assert.equal(normalizeQuery("  react   hooks \n"), "react hooks");
        assert.equal(normalizeQuery("a".repeat(500)).length, 100);
    });

    it("keeps letters and digits and drops everything that could be search syntax", () => {
        assert.deepEqual(extractTerms('"React" -hooks +state* (a) <b> @c ~d'), ["react", "hooks", "state"]);
        assert.deepEqual(extractTerms("'; DROP TABLE Posts; --"), ["drop", "table", "posts"]);
        assert.deepEqual(extractTerms("café 2024 日本"), ["café", "2024", "日本"]);
    });

    it("lowercases, drops one-letter words and repeats, and takes at most eight", () => {
        assert.deepEqual(extractTerms("a React react REACT b"), ["react"]);
        assert.equal(extractTerms("one two three four five six seven eight nine ten").length, 8);
        assert.deepEqual(extractTerms("+++ --- ***"), []);
    });

    it("finds tag slugs for each word and for the whole phrase", () => {
        assert.deepEqual(tagSlugsFor("node js", ["node", "js"]), ["node", "js", "node-js"]);
        assert.deepEqual(tagSlugsFor("日本", ["日本"]), []);
    });

    it("recognises whole words that could be usernames, underscores included", () => {
        assert.deepEqual(usernameCandidates("zelda_writer posts about React"), ["zelda_writer", "posts", "about", "react"]);
        assert.deepEqual(usernameCandidates("ab no-hyphens <bad>"), []);
    });

    it("falls back to a title match only when every word is too short for full-text search", () => {
        assert.equal(needsTitleFallback(["js"]), true);
        assert.equal(needsTitleFallback(["js", "go"]), true);
        assert.equal(needsTitleFallback(["js", "react"]), false);
    });

    it("makes % _ and backslash literal inside LIKE", () => {
        assert.equal(escapeLike("100%_\\"), "100\\%\\_\\\\");
    });
});
