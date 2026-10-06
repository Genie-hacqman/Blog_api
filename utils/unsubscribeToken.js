import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { JWT_ISSUER } from "../config/auth.js";
import { TYPE_NAMES, UNSUBSCRIBE_AUDIENCE, UNSUBSCRIBE_TTL_SECONDS } from "../config/notifications.js";

// The link in a notification email that turns that kind of email off (or all of them, scope "all").
// It has its own audience, so it is useless as an access token, and an access token is useless here.
export const signUnsubscribeToken = (userId, scope) =>
    jwt.sign({ scope }, env.JWT_SECRET, {
        algorithm: "HS256",
        issuer: JWT_ISSUER,
        audience: UNSUBSCRIBE_AUDIENCE,
        subject: String(userId),
        expiresIn: UNSUBSCRIBE_TTL_SECONDS,
    });

// -> { userId, scope } or null when the token is not valid (wrong, tampered, expired, someone else's kind of token)
export const verifyUnsubscribeToken = (token) => {
    try {
        const payload = jwt.verify(String(token), env.JWT_SECRET, { algorithms: ["HS256"], issuer: JWT_ISSUER, audience: UNSUBSCRIBE_AUDIENCE });
        const userId = Number(payload.sub);
        if (!Number.isInteger(userId) || userId <= 0) return null;
        if (payload.scope !== "all" && !TYPE_NAMES.includes(payload.scope)) return null;
        return { userId, scope: payload.scope };
    } catch {
        return null;
    }
};
