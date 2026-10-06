import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMetadata } from "../../utils/sanitizeMetadata.js";

describe("sanitizeMetadata", () => {
    it("drops credential-shaped keys at any depth, in objects and arrays", () => {
        const result = sanitizeMetadata({
            from: "author",
            password: "x",
            newPassword: "x",
            refreshToken: "x",
            Authorization: "x",
            nested: { cookie: "x", ok: 1, list: [{ secret: "x", keep: true }] },
            passwordHash: "x",
        });

        assert.deepEqual(result, { from: "author", nested: { ok: 1, list: [{ keep: true }] } });
    });

    it("leaves primitives, null and dates alone", () => {
        const date = new Date();

        assert.equal(sanitizeMetadata(5), 5);
        assert.equal(sanitizeMetadata(null), null);
        assert.equal(sanitizeMetadata(date), date);
    });
});
