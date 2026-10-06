import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ACCESS_TOKEN_TTL_SECONDS, JWT_AUDIENCE, JWT_ISSUER } from "../config/auth.js";

// opaque random token handed to the client (refresh cookie, email links)
export const generateToken = () => randomBytes(32).toString("base64url");

// only this hash is stored: the tokens are 256-bit random, so a fast hash is enough
// and a database leak does not yield usable tokens
export const hashToken = (token) => createHash("sha256").update(token).digest("hex");

// sid ties the access token to a refresh-token family (a login session), so ending the
// session invalidates the access token immediately
export const signAccessToken = ({ userId, sid }) =>
    jwt.sign({ sid }, env.JWT_SECRET, {
        algorithm: "HS256",
        subject: String(userId),
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

// throws on anything invalid, expired, wrongly signed, or issued for someone else
export const verifyAccessToken = (token) =>
    jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
