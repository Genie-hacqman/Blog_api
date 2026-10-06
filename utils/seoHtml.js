import { env } from "../config/env.js";
import { DESCRIPTION_MAX } from "../config/seo.js";

// Escaping and small helpers for the HTML the crawler snapshots are made of. Every value that is not markup
// we wrote ourselves passes through one of these.

export const escapeHtml = (value) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

// A <script type="application/ld+json"> block. JSON inside a script element ends at the first "</script", so
// "<", ">" and "&" are written as escapes (still valid JSON, the same text when parsed), as are the two line
// separators that older parsers treat as line breaks.
export const jsonLdScript = (data) => {
    const json = JSON.stringify(data)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
    return `<script type="application/ld+json">${json}</script>`;
};

// An address on this site (APP_URL is the public origin).
export const siteUrl = (path = "/") => `${env.APP_URL}${path.startsWith("/") ? path : `/${path}`}`;

// A full http(s) address for a stored one: absolute addresses pass (only http and https), site-relative ones
// ("/media/..." from the local storage provider) are put under APP_URL, anything else (protocol-relative,
// javascript:, data:) is not an address we hand out. Returns null when there is none.
export const absoluteUrl = (value) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (text.startsWith("//")) return null;
    if (text.startsWith("/")) return siteUrl(text);
    try {
        const url = new URL(text);
        return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
};

// A description for a search result or a link card: one line, cut at a word boundary, with an ellipsis.
export const describe = (text, max = DESCRIPTION_MAX) => {
    const flat = String(text ?? "").replace(/\s+/g, " ").trim();
    if (flat.length <= max) return flat;
    const cut = flat.slice(0, max - 1);
    const lastSpace = cut.lastIndexOf(" ");
    const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${base.replace(/[\s,;:.\-–—]+$/, "")}…`;
};
