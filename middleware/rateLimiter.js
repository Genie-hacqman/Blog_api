import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";
import { TooManyRequestsError } from "../utils/AppError.js";

// shared settings; the handler hands off to the central error handler so 429s use the standard envelope
const limiter = ({ windowMs, max, message, skipSuccessfulRequests = false }) =>
    rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests,
        skip: () => env.isTest,
        handler: (req, res, next) => next(new TooManyRequestsError(message)),
    });

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// slow down brute-force/credential-stuffing attempts against login; only failures count,
// so a household behind one IP is not locked out by successful logins
export const loginRateLimiter = limiter({
    windowMs: 15 * MINUTE,
    max: 5,
    skipSuccessfulRequests: true,
    message: "Too many login attempts. Please try again later.",
});

// slow down registration spam
export const registerRateLimiter = limiter({
    windowMs: HOUR,
    max: 10,
    message: "Too many accounts created from this IP. Please try again later.",
});

// each of these can trigger an email or guess a token, so they are tight
export const forgotPasswordRateLimiter = limiter({ windowMs: HOUR, max: 5, message: "Too many reset requests. Please try again later." });
export const resendVerificationRateLimiter = limiter({ windowMs: HOUR, max: 5, message: "Too many verification emails requested. Please try again later." });
export const tokenRateLimiter = limiter({ windowMs: HOUR, max: 20, message: "Too many attempts. Please try again later." });
export const changePasswordRateLimiter = limiter({ windowMs: HOUR, max: 10, message: "Too many attempts. Please try again later." });

// the SPA refreshes on page load and when an access token expires; generous but bounded
export const refreshRateLimiter = limiter({ windowMs: 15 * MINUTE, max: 60, message: "Too many session refreshes. Please try again later." });

// every upload is decoded and re-encoded, which costs CPU; the per-user daily quota sits behind this
export const uploadRateLimiter = limiter({ windowMs: HOUR, max: 30, message: "Too many uploads. Please try again later." });

export const accountDeletionRateLimiter = limiter({ windowMs: HOUR, max: 5, message: "Too many attempts. Please try again later." });

// every search is a ranked full-text query
export const searchRateLimiter = limiter({ windowMs: MINUTE, max: 60, message: "Too many searches. Please wait a moment." });

// writing comments (the per-user hourly quota in commentService is the stricter limit)
export const commentRateLimiter = limiter({ windowMs: 10 * MINUTE, max: 20, message: "You are commenting too quickly. Please wait a moment." });

// the inbox and the unread badge are polled by every open tab
export const notificationRateLimiter = limiter({ windowMs: 10 * MINUTE, max: 200, message: "Too many requests. Please wait a moment." });

// the unsubscribe link is public, so it is bounded
export const unsubscribeRateLimiter = limiter({ windowMs: HOUR, max: 20, message: "Too many attempts. Please try again later." });

// filing reports (the per-person hourly count in reportService is the stricter limit)
export const reportRateLimiter = limiter({ windowMs: HOUR, max: 20, message: "You are filing reports too quickly. Please wait." });

// the reading beacons are sent by every open story page; generous for a person, not for a flood
export const analyticsRateLimiter = limiter({ windowMs: MINUTE, max: 120, message: "Too many requests." });

// likes, bookmarks and follows: cheap, so generous, but bounded
export const reactionRateLimiter = limiter({ windowMs: 10 * MINUTE, max: 120, message: "Too many actions. Please wait a moment." });

// crawlers (search engines, link-preview fetchers) read sitemaps, feeds and snapshots; generous, but rendering is not free
export const seoRateLimiter = limiter({ windowMs: MINUTE, max: 300, message: "Too many requests." });

