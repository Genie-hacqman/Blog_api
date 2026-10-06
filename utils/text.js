import { MAX_EXCERPT_LENGTH, WORDS_PER_MINUTE } from "../config/posts.js";

// a short teaser taken from the start of the post's plain text (see htmlToText in utils/richText.js); with its ellipsis it never exceeds MAX_EXCERPT_LENGTH
export const autoExcerpt = (content) => {
    const text = String(content ?? "").trim();
    return text.length > MAX_EXCERPT_LENGTH ? `${text.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…` : text;
};

export const wordCount = (content) => String(content ?? "").trim().split(/\s+/).filter(Boolean).length;

export const readingTimeOf = (content) => Math.max(1, Math.round(wordCount(content) / WORDS_PER_MINUTE));
