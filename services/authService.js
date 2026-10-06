import { randomUUID } from "node:crypto";
import {
    createUser,
    findUserByEmail,
    findUserById,
    findUserByUsername,
    incrementFailedLogins,
    updateUserById,
} from "../repositories/userRepository.js";
import {
    createRefreshToken,
    findRefreshTokenByHash,
    isFamilyActive,
    markRotated,
    revokeAllForUser,
    revokeFamily,
} from "../repositories/refreshTokenRepository.js";
import {
    countTokensSince,
    createUserToken,
    findUsableToken,
    invalidateUnusedTokens,
    markTokenUsed,
} from "../repositories/userTokenRepository.js";
import { withTransaction } from "../database/transaction.js";
import { sanitizeUser } from "./userService.js";
import { recordAudit } from "./auditService.js";
import {
    sendPasswordChangedEmail,
    sendPasswordResetEmail,
    sendVerificationEmail,
    sendWelcomeEmail,
} from "./emailService.js";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../utils/hash.js";
import { generateToken, hashToken, signAccessToken } from "../utils/tokens.js";
import { AppError, ConflictError, TooManyRequestsError, UnauthorizedError } from "../utils/AppError.js";
import {
    LOCKOUT_MS,
    MAX_FAILED_LOGINS,
    REFRESH_GRACE_MS,
    REFRESH_TOKEN_TTL_MS,
    RESET_PASSWORD_TTL_MS,
    RESET_REQUESTS_PER_HOUR,
    VERIFY_EMAIL_TTL_MS,
} from "../config/auth.js";

const HOUR_MS = 60 * 60 * 1000;

const invalidToken = () => new AppError(400, "INVALID_TOKEN", "This link is invalid or has expired");
const invalidCredentials = () => new UnauthorizedError("Invalid email or password");

// Emails are sent without waiting for the provider, so a slow mail server cannot slow (or
// time) the request. Delivery failures are logged inside emailService.
const sendInBackground = (promise) => {
    void promise;
};

// ---------- sessions ----------

// a login session = a family of refresh tokens; the access token is bound to the family id
const startSession = async (user, context, options = {}) => {
    const familyId = randomUUID();
    const refreshToken = generateToken();
    await createRefreshToken(
        { userId: user.id, tokenHash: hashToken(refreshToken), familyId, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), ip: context.ip, userAgent: context.userAgent },
        options,
    );
    return { accessToken: signAccessToken({ userId: user.id, sid: familyId }), refreshToken };
};

// ---------- email tokens ----------

const issueEmailToken = async (user, purpose, ttlMs, options = {}) => {
    await invalidateUnusedTokens(user.id, purpose, options);
    const token = generateToken();
    await createUserToken({ userId: user.id, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) }, options);
    return token;
};

// ---------- register / login ----------

export const registerUser = async ({ firstName, lastName, userName, email, password }, context) => {
    if (await findUserByEmail(email)) {
        throw new ConflictError("Email is already taken");
    }
    if (await findUserByUsername(userName)) {
        throw new ConflictError("Username is already taken");
    }

    const user = await createUser({ firstName, lastName, username: userName, email, password: await hashPassword(password) });

    const token = await issueEmailToken(user, "verify_email", VERIFY_EMAIL_TTL_MS);
    sendInBackground(sendVerificationEmail(user, token));
    await recordAudit({ actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id }, { context });

    return sanitizeUser(user);
};

export const loginUser = async ({ email, password }, context) => {
    const user = await findUserByEmail(email, { withAvatar: true });

    // unknown and deleted accounts take as long as a wrong password and answer the same way
    if (!user || user.status === "deleted") {
        await burnPasswordCheck(password);
        throw invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
        throw new TooManyRequestsError("Too many failed attempts. Try again in a few minutes.");
    }

    const { valid, needsRehash } = await verifyPassword(password, user.password);

    if (!valid) {
        const failures = await incrementFailedLogins(user.id);
        if (failures >= MAX_FAILED_LOGINS) {
            await updateUserById(user.id, { lockedUntil: new Date(Date.now() + LOCKOUT_MS), failedLoginCount: 0 });
            await recordAudit({ actorId: null, action: "auth.account_locked", entityType: "user", entityId: user.id, metadata: { failures } }, { context });
        }
        throw invalidCredentials();
    }

    if (user.status !== "active") {
        // only said after the password was right, so it tells nothing to someone who is guessing
        throw new AppError(403, "ACCOUNT_SUSPENDED", `This account has been suspended${user.suspendedReason ? `: ${user.suspendedReason}` : ""}`);
    }

    const update = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() };
    if (needsRehash) {
        update.password = await hashPassword(password);
    }
    await updateUserById(user.id, update);

    const session = await startSession(user, context);
    await recordAudit({ actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id }, { context });

    return { user: sanitizeUser(user), ...session };
};

// ---------- refresh / logout ----------

export const refreshSession = async (rawToken, context) => {
    if (!rawToken) {
        throw new UnauthorizedError("No session");
    }

    const row = await findRefreshTokenByHash(hashToken(rawToken));
    if (!row) {
        throw new UnauthorizedError("Invalid session");
    }

    const loadActiveUser = async () => {
        const user = await findUserById(row.userId, { withAvatar: true });
        if (!user || user.status !== "active") {
            await revokeFamily(row.familyId);
            throw new UnauthorizedError("Invalid session");
        }
        return user;
    };

    // two tabs refreshing together both present the same cookie; the loser of the race gets
    // an access token but no new cookie (the winner's response already set it)
    const gracefulReplay = async () => {
        const user = await loadActiveUser();
        return { user: sanitizeUser(user), accessToken: signAccessToken({ userId: user.id, sid: row.familyId }), refreshToken: null };
    };

    if (row.revokedAt) {
        const wasRotated = row.replacedById !== null;
        if (!wasRotated) {
            throw new UnauthorizedError("Session has ended"); // logged out or revoked
        }
        if (Date.now() - row.revokedAt.getTime() < REFRESH_GRACE_MS && (await isFamilyActive(row.familyId))) {
            return gracefulReplay();
        }
        // an old, already-rotated token is back: assume it was stolen and end the whole session
        await revokeFamily(row.familyId);
        await recordAudit({ actorId: row.userId, action: "auth.refresh_reuse_detected", entityType: "user", entityId: row.userId }, { context });
        throw new UnauthorizedError("Session has ended");
    }

    if (row.expiresAt <= new Date()) {
        throw new UnauthorizedError("Session has expired");
    }

    const user = await loadActiveUser();
    const refreshToken = generateToken();

    const rotated = await withTransaction(async (transaction) => {
        const next = await createRefreshToken(
            { userId: user.id, tokenHash: hashToken(refreshToken), familyId: row.familyId, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS), ip: context.ip, userAgent: context.userAgent },
            { transaction },
        );
        // zero rows means another request rotated this token first
        return (await markRotated(row.id, next.id, { transaction })) === 1;
    });

    if (!rotated) {
        return gracefulReplay();
    }

    return { user: sanitizeUser(user), accessToken: signAccessToken({ userId: user.id, sid: row.familyId }), refreshToken };
};

// ends the session the cookie belongs to; always succeeds so logging out twice is harmless
export const logout = async (rawToken) => {
    if (!rawToken) return;
    const row = await findRefreshTokenByHash(hashToken(rawToken));
    if (row) {
        await revokeFamily(row.familyId);
    }
};

export const logoutEverywhere = async (userId, context) => {
    await revokeAllForUser(userId);
    await recordAudit({ actorId: userId, action: "auth.logout_all", entityType: "user", entityId: userId }, { context });
};

export const getCurrentUser = async (userId) => sanitizeUser(await findUserById(userId, { withAvatar: true }));

// ---------- email verification ----------

export const verifyEmail = async (rawToken, context) => {
    const tokenRow = await findUsableToken("verify_email", hashToken(rawToken));
    if (!tokenRow) {
        throw invalidToken();
    }

    await withTransaction(async (transaction) => {
        if ((await markTokenUsed(tokenRow.id, { transaction })) !== 1) {
            throw invalidToken();
        }
        await updateUserById(tokenRow.userId, { emailVerifiedAt: new Date() }, { transaction });
    });

    const user = await findUserById(tokenRow.userId);
    await recordAudit({ actorId: user.id, action: "auth.email_verified", entityType: "user", entityId: user.id }, { context });
    sendInBackground(sendWelcomeEmail(user));
};

export const resendVerification = async (userId) => {
    const user = await findUserById(userId);
    if (user.emailVerifiedAt) {
        return;
    }
    const recent = await countTokensSince(user.id, "verify_email", new Date(Date.now() - HOUR_MS));
    if (recent >= RESET_REQUESTS_PER_HOUR) {
        throw new TooManyRequestsError("A verification email was sent recently. Check your inbox or try again later.");
    }
    const token = await issueEmailToken(user, "verify_email", VERIFY_EMAIL_TTL_MS);
    sendInBackground(sendVerificationEmail(user, token));
};

// ---------- passwords ----------

// Callers answer identically whether or not the account exists.
export const requestPasswordReset = async (email) => {
    const user = await findUserByEmail(email);
    if (!user || user.status === "deleted") {
        return;
    }
    const recent = await countTokensSince(user.id, "reset_password", new Date(Date.now() - HOUR_MS));
    if (recent >= RESET_REQUESTS_PER_HOUR) {
        return;
    }
    const token = await issueEmailToken(user, "reset_password", RESET_PASSWORD_TTL_MS);
    sendInBackground(sendPasswordResetEmail(user, token));
};

export const resetPassword = async ({ token, password }, context) => {
    const tokenRow = await findUsableToken("reset_password", hashToken(token));
    if (!tokenRow) {
        throw invalidToken();
    }

    const passwordHash = await hashPassword(password);

    await withTransaction(async (transaction) => {
        if ((await markTokenUsed(tokenRow.id, { transaction })) !== 1) {
            throw invalidToken();
        }
        const user = await findUserById(tokenRow.userId, { transaction });
        await updateUserById(
            user.id,
            {
                password: passwordHash,
                failedLoginCount: 0,
                lockedUntil: null,
                // receiving the link proves the mailbox is theirs
                emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
            },
            { transaction },
        );
        await revokeAllForUser(user.id, { transaction });
        await recordAudit({ actorId: user.id, action: "auth.password_reset", entityType: "user", entityId: user.id }, { context, transaction });
    });

    sendInBackground(sendPasswordChangedEmail(await findUserById(tokenRow.userId)));
};

export const changePassword = async (userId, sid, { currentPassword, newPassword }, context) => {
    const user = await findUserById(userId);

    const { valid } = await verifyPassword(currentPassword, user.password);
    if (!valid) {
        // 400, not 401: a 401 would make the client think the session expired
        throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect");
    }
    if (currentPassword === newPassword) {
        throw new AppError(400, "VALIDATION_ERROR", "New password must be different from the current one");
    }

    const passwordHash = await hashPassword(newPassword);

    await withTransaction(async (transaction) => {
        await updateUserById(userId, { password: passwordHash }, { transaction });
        // every other device is signed out; this one stays
        await revokeAllForUser(userId, { exceptFamilyId: sid, transaction });
        await recordAudit({ actorId: userId, action: "auth.password_changed", entityType: "user", entityId: userId }, { context, transaction });
    });

    sendInBackground(sendPasswordChangedEmail(user));
};
