import pino from "pino";
import { env } from "./env.js";

// secrets must never reach the logs, even if a request/response object gets logged whole
export const redactPaths = [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
    "*.password",
    "*.token",
    "*.refreshToken",
];

const logger = pino({
    level: env.LOG_LEVEL,
    redact: { paths: redactPaths, censor: "[redacted]" },
    // human-readable output locally; JSON lines everywhere else (pino-pretty is a dev dependency)
    ...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty" } }),
});

export default logger;
