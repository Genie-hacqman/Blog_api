import { env } from "../config/env.js";
import { DEFAULT_IMAGE_PATH } from "../config/seo.js";
import { escapeHtml, jsonLdScript, siteUrl } from "../utils/seoHtml.js";

// The plain HTML document a crawler gets for a public page: the same facts the app shows (title, text, author,
// date), the metadata the app sets in the browser, and nothing else. No scripts (apart from the JSON-LD data
// block, which is not executed), no styles, no images except the story's own. Every value is escaped here; the
// only markup that is not is `bodyHtml`, which callers build from escaped parts and sanitized story HTML.

const meta = (attribute, name, content) => (content ? `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(content)}">` : "");

export const renderSnapshot = ({
    title,
    ogTitle = title,
    description,
    canonical,
    image = null,
    imageAlt = "",
    type = "website",
    robots = "index,follow",
    jsonLd = null,
    prev = null,
    next = null,
    article = null,
    bodyHtml,
}) => {
    // a page without a picture of its own is shared with the publication's default one
    const shareImage = image ?? siteUrl(DEFAULT_IMAGE_PATH);
    const fullTitle = title === env.SITE_NAME ? title : `${title} — ${env.SITE_NAME}`;
    const head = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapeHtml(fullTitle)}</title>`,
        meta("name", "description", description),
        meta("name", "robots", robots),
        `<link rel="canonical" href="${escapeHtml(canonical)}">`,
        prev ? `<link rel="prev" href="${escapeHtml(prev)}">` : "",
        next ? `<link rel="next" href="${escapeHtml(next)}">` : "",
        `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(env.SITE_NAME)}" href="${escapeHtml(siteUrl("/feed.xml"))}">`,
        meta("property", "og:site_name", env.SITE_NAME),
        meta("property", "og:locale", "en_US"),
        meta("property", "og:type", type),
        meta("property", "og:title", ogTitle),
        meta("property", "og:description", description),
        meta("property", "og:url", canonical),
        meta("property", "og:image", shareImage),
        meta("property", "og:image:alt", image ? imageAlt : ""),
        meta("name", "twitter:card", "summary_large_image"),
        meta("name", "twitter:title", ogTitle),
        meta("name", "twitter:description", description),
        meta("name", "twitter:image", shareImage),
        meta("name", "twitter:image:alt", image ? imageAlt : ""),
        article ? meta("property", "article:published_time", article.published) : "",
        article ? meta("property", "article:modified_time", article.modified) : "",
        article ? meta("property", "article:author", article.authorUrl) : "",
        ...(article?.tags ?? []).map((tag) => meta("property", "article:tag", tag)),
        jsonLd ? jsonLdScript(jsonLd) : "",
    ]
        .filter(Boolean)
        .join("\n");

    return [
        "<!doctype html>",
        '<html lang="en">',
        `<head>\n${head}\n</head>`,
        "<body>",
        `<header><p><a href="${escapeHtml(siteUrl("/"))}">${escapeHtml(env.SITE_NAME)}</a> · ${escapeHtml(env.SITE_TAGLINE)}</p></header>`,
        `<main>\n${bodyHtml}\n</main>`,
        `<footer><p><a href="${escapeHtml(canonical)}">Read this page on ${escapeHtml(env.SITE_NAME)}</a></p></footer>`,
        "</body>",
        "</html>",
    ].join("\n");
};

// a page that does not exist (or is not public): the same words whatever the reason
export const renderNotFound = () =>
    renderSnapshot({
        title: "Page not found",
        description: "",
        canonical: siteUrl("/"),
        robots: "noindex,nofollow",
        bodyHtml: `<h1>Page not found</h1>\n<p><a href="${escapeHtml(siteUrl("/"))}">Go to the front page</a></p>`,
    });
