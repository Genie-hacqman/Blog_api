// Tunable security constants for authentication. Durations are in milliseconds unless noted.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * DAY; // sliding: every rotation extends it
// a rotated refresh token presented again inside this window is treated as a multi-tab race, not theft
export const REFRESH_GRACE_MS = 10 * 1000;

export const VERIFY_EMAIL_TTL_MS = 24 * HOUR;
export const RESET_PASSWORD_TTL_MS = 1 * HOUR;
// at most this many reset emails per account per hour
export const RESET_REQUESTS_PER_HOUR = 3;

// consecutive failed logins before an account is locked, and for how long
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MS = 15 * MINUTE;

export const JWT_ISSUER = "blog-api";
export const JWT_AUDIENCE = "blog-web";

export const REFRESH_COOKIE_NAME = "refresh_token";
export const REFRESH_COOKIE_PATH = "/api/auth";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
