import { MAX_SLUG_LENGTH } from "../config/posts.js";

// "How to Build JWT Authentication!" -> "how-to-build-jwt-authentication"
// Accents are folded (é -> e); anything that is not a letter or digit becomes a hyphen.
export const slugify = (text) => {
    const slug = String(text ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLUG_LENGTH - 8) // leave room for a "-123" collision suffix
        .replace(/-+$/g, "");
    return slug || "post";
};

// the n-th attempt at a free slug: base, base-2, base-3 ...
export const withSuffix = (base, attempt) => (attempt <= 1 ? base : `${base}-${attempt}`);

// Was this slug generated from this title (rather than chosen by the author)? Generated slugs
// follow the title while the post is unpublished; chosen ones are left alone.
export const isAutoSlug = (slug, title) => {
    const base = slugify(title);
    return slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)));
};
