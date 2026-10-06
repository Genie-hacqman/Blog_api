import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { BOT_PATTERN, DIRECT_LABEL, INTERNAL_LABEL, MAX_HOST_LENGTH, OTHER_LABEL } from "../config/analytics.js";

// One key per day, derived from the server secret and the date with a purpose label. Yesterday's key cannot be
// worked out from today's data and the secret is not used for anything else here: visitors cannot be linked across days.
const keyFor = (day) => createHmac("sha256", env.JWT_SECRET).update(`analytics-visitor:${day}`).digest();

// A short one-way code that tells one visitor from another within a day. The address and the browser string go in;
// only this comes out, and neither is stored anywhere.
export const visitorHash = (ip, userAgent, day) =>
    createHmac("sha256", keyFor(day)).update(`${ip ?? ""}|${userAgent ?? ""}`).digest("hex").slice(0, 32);

// no browser string at all is not a browser
export const looksLikeBot = (userAgent) => !userAgent || BOT_PATTERN.test(userAgent);

const ownHosts = () => {
    const hosts = new Set();
    for (const origin of [env.APP_URL, ...env.CLIENT_ORIGINS]) {
        try {
            hosts.add(new URL(origin).hostname.replace(/^www\./, "").toLowerCase());
        } catch {
            // not a URL: nothing to learn
        }
    }
    return hosts;
};

// Where a reader came from, reduced to a hostname: never a path, a query or anything personal.
// No referrer is "(direct)", our own site "(internal)", and anything odd (not http/https, not a plausible host) "(other)".
export const referrerHost = (referrer) => {
    if (!referrer || typeof referrer !== "string") return DIRECT_LABEL;
    let url;
    try {
        url = new URL(referrer);
    } catch {
        return OTHER_LABEL;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return OTHER_LABEL;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host || host.length > MAX_HOST_LENGTH || !/^[a-z0-9.-]+$/.test(host)) return OTHER_LABEL;
    return ownHosts().has(host) ? INTERNAL_LABEL : host;
};
