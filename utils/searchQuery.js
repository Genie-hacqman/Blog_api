import { FULLTEXT_MIN_TOKEN, SEARCH_MAX_TERMS, SEARCH_QUERY_MAX } from "../config/taxonomy.js";
import { asciiSlug } from "./taxonomy.js";

// what was typed, tidied and capped
export const normalizeQuery = (raw) => String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX);

// The words to look for: letters and digits only, lowercased, two characters or more, no repeats.
// Everything else a user can type (+ - * " ( ) < > @ ~ and so on) is dropped here, so the search
// engine never receives query syntax that the user controls.
export const extractTerms = (query) => {
    const words = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return [...new Set(words.filter((word) => word.length >= 2))].slice(0, SEARCH_MAX_TERMS);
};

// Tag slugs that count as a match: each word, and the whole phrase ("node js" also finds the tag "node-js").
export const tagSlugsFor = (query, terms) => {
    const slugs = [...terms.map(asciiSlug), asciiSlug(query)].filter(Boolean);
    return [...new Set(slugs)];
};

// Words that could be a username, whole (usernames contain underscores, which split the search words above).
export const usernameCandidates = (query) =>
    [...new Set(String(query).toLowerCase().split(" ").filter((word) => /^[a-z0-9_]{3,30}$/.test(word)))].slice(0, SEARCH_MAX_TERMS);

// full-text search ignores short words, so a query made only of them (e.g. "js") falls back to a title match
export const needsTitleFallback = (terms) => terms.every((term) => term.length < FULLTEXT_MIN_TOKEN);

// make a string safe to use inside LIKE: % _ and \ are taken literally
export const escapeLike = (text) => String(text).replace(/[\\%_]/g, (char) => `\\${char}`);
