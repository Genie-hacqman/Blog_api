import rateLimit from "express-rate-limit";

// slow down brute-force/credential-stuffing attempts against login
export const loginRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { error: "Too many login attempts. Please try again later." },
});

// slow down registration spam
export const registerRateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    message: { error: "Too many accounts created from this IP. Please try again later." },
});
