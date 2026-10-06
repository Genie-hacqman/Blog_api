import { TAG_NAME_MAX, TAG_NAME_MIN } from "../config/taxonomy.js";
import { slugify } from "./slug.js";
import { ValidationError } from "./AppError.js";

// the spelling people typed, tidied: one space between words, no leading or trailing space
export const tidyName = (raw) => String(raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// letters and digits (any language), words separated by single spaces or hyphens
const TAG_PATTERN = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;

// "Node JS" -> "node-js". Returns null when nothing ASCII is left (a name made only of symbols or
// of non-Latin letters), because slugs are ASCII and "everything becomes the same slug" would merge unrelated tags.
export const asciiSlug = (text) => {
    const folded = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return /[A-Za-z0-9]/.test(folded) ? slugify(text) : null;
};

// Validate and normalize the tag names sent with a post. Names that differ only by case, accents
// or spacing are one tag (the first spelling wins). Throws a ValidationError that names the problem.
export const prepareTags = (names) => {
    const seen = new Map();
    for (const raw of names ?? []) {
        const name = tidyName(raw);
        if (name.length < TAG_NAME_MIN || name.length > TAG_NAME_MAX) {
            throw new ValidationError(`Tag "${name.slice(0, 40)}" must be ${TAG_NAME_MIN} to ${TAG_NAME_MAX} characters`);
        }
        if (!TAG_PATTERN.test(name)) {
            throw new ValidationError(`Tag "${name}" can only contain letters, numbers, spaces and hyphens`);
        }
        const slug = asciiSlug(name);
        if (!slug) {
            throw new ValidationError(`Tag "${name}" must include at least one letter or number from A to Z`);
        }
        if (!seen.has(slug)) seen.set(slug, { name, slug });
    }
    return [...seen.values()];
};
