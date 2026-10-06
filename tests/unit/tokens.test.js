import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { generateToken, hashToken, signAccessToken, verifyAccessToken } from "../../utils/tokens.js";
import { env } from "../../config/env.js";

describe("tokens", () => {
    it("generates long, unique, URL-safe tokens", () => {
        const a = generateToken();
        const b = generateToken();

        assert.notEqual(a, b);
        assert.match(a, /^[\w-]{43}$/);
    });

    it("hashes deterministically to 64 hex characters that do not contain the token", () => {
        const token = generateToken();

        assert.equal(hashToken(token), hashToken(token));
        assert.match(hashToken(token), /^[0-9a-f]{64}$/);
        assert.ok(!hashToken(token).includes(token));
        assert.notEqual(hashToken(token), hashToken(`${token}x`));
    });

    it("round-trips an access token with subject, session and a 15 minute lifetime", () => {
        const payload = verifyAccessToken(signAccessToken({ userId: 42, sid: "session-1" }));

        assert.equal(payload.sub, "42");
        assert.equal(payload.sid, "session-1");
        assert.equal(payload.iss, "blog-api");
        assert.equal(payload.aud, "blog-web");
        assert.equal(payload.exp - payload.iat, 15 * 60);
    });

    it("rejects tokens signed with another key or algorithm", () => {
        const base = { subject: "1", issuer: "blog-api", audience: "blog-web", expiresIn: 60 };

        assert.throws(() => verifyAccessToken(jwt.sign({ sid: "s" }, "other-key", base)));
        assert.throws(() => verifyAccessToken(jwt.sign({ sid: "s" }, env.JWT_SECRET, { ...base, algorithm: "HS512" })));
    });
});
