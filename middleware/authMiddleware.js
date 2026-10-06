import { verifyAccessToken } from "../utils/tokens.js";
import { findUserById } from "../repositories/userRepository.js";
import { isFamilyActive } from "../repositories/refreshTokenRepository.js";
import { UnauthorizedError } from "../utils/AppError.js";

// Requires a valid access token that belongs to a live session of an active account.
// Role and status come from the database on every request (never from the token), so a
// role change, suspension, logout or password change takes effect immediately.
export const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
        throw new UnauthorizedError("Bearer token is required");
    }

    let payload;
    try {
        payload = verifyAccessToken(authHeader.slice(7));
    } catch {
        throw new UnauthorizedError("Invalid or expired token");
    }

    const user = await findUserById(payload.sub);
    if (!user || user.status !== "active") {
        throw new UnauthorizedError("Invalid or expired token");
    }
    if (!(await isFamilyActive(payload.sid))) {
        throw new UnauthorizedError("Session has ended");
    }

    req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        emailVerified: Boolean(user.emailVerifiedAt),
    };
    req.sid = payload.sid;
    next();
};

// For endpoints that must never fail because of a token (the reading beacon): a valid token identifies the
// viewer, anything else (none, expired, garbage) simply means an anonymous visitor.
export const softAuthenticate = async (req, res, next) => {
    if (req.headers.authorization) {
        try {
            await authenticate(req, res, () => {});
        } catch {
            req.user = undefined;
        }
    }
    next();
};

// For routes that are public but show more to a signed-in viewer (a published post is for everyone,
// the author also sees their own drafts). No Authorization header means an anonymous visitor.
// A header that is present must be valid: an expired token gets a 401, so the client refreshes and
// retries, instead of silently being treated as a stranger.
export const optionalAuthenticate = async (req, res, next) => {
    if (!req.headers.authorization) {
        return next();
    }
    return authenticate(req, res, next);
};
