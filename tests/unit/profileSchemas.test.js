import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateProfileSchema, uploadPurposeSchema } from "../../schemas/profileSchemas.js";
import { createUserSchema } from "../../schemas/userSchemas.js";

const parse = (body) => updateProfileSchema.safeParse(body);

describe("updateProfileSchema", () => {
    it("normalizes a bio: strips control characters, trims, empty becomes null", () => {
        assert.equal(parse({ bio: "  hi\u0000 there\u0007  " }).data.bio, "hi there");
        assert.equal(parse({ bio: "   " }).data.bio, null);
    });

    it("keeps newlines in a bio", () => {
        assert.equal(parse({ bio: "line one\nline two" }).data.bio, "line one\nline two");
    });

    it("drops cleared links and turns an empty set into null", () => {
        assert.deepEqual(parse({ socialLinks: { website: "", github: "https://github.com/a" } }).data.socialLinks, { github: "https://github.com/a" });
        assert.equal(parse({ socialLinks: { website: "" } }).data.socialLinks, null);
    });

    it("matches platform hosts exactly or as a subdomain, never as a suffix of another name", () => {
        assert.ok(parse({ socialLinks: { github: "https://gist.github.com/a" } }).success);
        assert.ok(parse({ socialLinks: { twitter: "https://twitter.com/a" } }).success);
        assert.ok(!parse({ socialLinks: { github: "https://notgithub.com/a" } }).success);
        assert.ok(!parse({ socialLinks: { github: "https://github.com.evil.io/a" } }).success);
    });

    it("rejects unknown keys at both levels and an update that changes nothing", () => {
        assert.ok(!parse({ bio: "x", role: "admin" }).success);
        assert.ok(!parse({ socialLinks: { myspace: "https://myspace.com/a" } }).success);
        assert.ok(!parse({}).success);
    });
});

describe("uploadPurposeSchema", () => {
    it("allows cover and inline only", () => {
        assert.ok(uploadPurposeSchema.safeParse({ purpose: "cover" }).success);
        assert.ok(uploadPurposeSchema.safeParse({ purpose: "inline" }).success);
        assert.ok(!uploadPurposeSchema.safeParse({ purpose: "avatar" }).success);
    });
});

describe("createUserSchema usernames", () => {
    const base = { firstName: "A", lastName: "B", email: "a@example.com", password: "password123" };

    it("trims then validates", () => {
        assert.equal(createUserSchema.safeParse({ ...base, userName: "  ada_1  " }).data.userName, "ada_1");
    });

    it("explains each failure", () => {
        const message = (userName) => createUserSchema.safeParse({ ...base, userName }).error.issues[0].message;

        assert.match(message("ab"), /at least 3/);
        assert.match(message("a".repeat(31)), /at most 30/);
        assert.match(message("a b"), /letters, numbers and underscores/);
        assert.match(message("admin"), /not available/);
    });
});
