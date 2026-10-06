import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../../utils/hash.js";

describe("hash", () => {
    it("hashes with argon2id and verifies the right password only", async () => {
        const hash = await hashPassword("correct horse battery");

        assert.match(hash, /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
        assert.deepEqual(await verifyPassword("correct horse battery", hash), { valid: true, needsRehash: false });
        assert.deepEqual(await verifyPassword("wrong", hash), { valid: false, needsRehash: false });
    });

    it("salts: hashing the same password twice gives different hashes", async () => {
        assert.notEqual(await hashPassword("same"), await hashPassword("same"));
    });

    it("verifies legacy bcrypt hashes and flags only valid ones for upgrade", async () => {
        const legacy = await bcrypt.hash("old password", 10);

        assert.deepEqual(await verifyPassword("old password", legacy), { valid: true, needsRehash: true });
        assert.deepEqual(await verifyPassword("nope", legacy), { valid: false, needsRehash: false });
    });

    it("flags argon2id hashes made with weaker parameters", async () => {
        const argon2 = (await import("argon2")).default;
        const weak = await argon2.hash("pw", { type: argon2.argon2id, memoryCost: 4096, timeCost: 1, parallelism: 1 });

        assert.deepEqual(await verifyPassword("pw", weak), { valid: true, needsRehash: true });
    });

    it("burnPasswordCheck resolves without revealing anything", async () => {
        assert.equal(await burnPasswordCheck("whatever"), undefined);
    });
});
