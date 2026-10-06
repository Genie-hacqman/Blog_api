import { env } from "../config/env.js";
import { DISALLOWED_PATHS, FEED_LIMIT, SITEMAP_CHUNK, SNAPSHOT_MAX_PAGE, SNAPSHOT_PAGE_SIZE } from "../config/seo.js";
import { findPostBySlug, findPublishedPage } from "../repositories/postRepository.js";
import { findCategoryBySlug } from "../repositories/categoryRepository.js";
import { findTagBySlug } from "../repositories/tagRepository.js";
import { findUserByUsername } from "../repositories/userRepository.js";
import {
    countPublished,
    findContentsByIds,
    listAuthorsWithPublished,
    listCategoriesWithPublished,
    listPublishedForSitemap,
    listTagsWithPublished,
} from "../repositories/seoRepository.js";
import { attachTags } from "./tagService.js";
import { toPostDto, toPreview } from "./postService.js";
import { renderSnapshot } from "../views/snapshot.js";
import { htmlToText, sanitizeContent } from "../utils/richText.js";
import { absoluteUrl, describe, escapeHtml, siteUrl } from "../utils/seoHtml.js";
import { emptyElement, groupElement, textElement, XML_DECLARATION } from "../utils/xml.js";
import { avatarUrlOf } from "../utils/author.js";
import { NotFoundError } from "../utils/AppError.js";

// Everything search engines and link previews get: robots.txt, sitemaps, RSS feeds and the plain HTML snapshots
// of public pages. All of it shows only what the public API already shows to anyone: published stories, active
// authors' profiles, sections and topics. Addresses are built from APP_URL.

const iso = (value) => (value ? new Date(value).toISOString() : undefined);

// ---------- robots.txt ----------

export const robotsTxt = () =>
    ["User-agent: *", ...DISALLOWED_PATHS.map((path) => `Disallow: ${path}`), "", `Sitemap: ${siteUrl("/sitemap.xml")}`, ""].join("\n");

// ---------- sitemaps ----------

const SITEMAP_NS = { xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9" };

const urlEntry = (path, lastmod) =>
    groupElement("url", [textElement("loc", siteUrl(path)), ...(lastmod ? [textElement("lastmod", iso(lastmod))] : [])]);

const urlset = (entries) => `${XML_DECLARATION}\n${groupElement("urlset", entries, SITEMAP_NS)}\n`;

// the index lists the fixed-pages file and one file per SITEMAP_CHUNK stories
export const sitemapIndex = async () => {
    const total = await countPublished();
    const files = ["/sitemap-pages.xml", ...Array.from({ length: Math.ceil(total / SITEMAP_CHUNK) }, (_, i) => `/sitemap-posts-${i + 1}.xml`)];
    const entries = files.map((path) => groupElement("sitemap", [textElement("loc", siteUrl(path))]));
    return `${XML_DECLARATION}\n${groupElement("sitemapindex", entries, SITEMAP_NS)}\n`;
};

// the front page, and the sections, topics and authors that have something published
export const sitemapPages = async () => {
    const [categories, tags, authors] = await Promise.all([
        listCategoriesWithPublished(SITEMAP_CHUNK),
        listTagsWithPublished(SITEMAP_CHUNK),
        listAuthorsWithPublished(SITEMAP_CHUNK),
    ]);
    return urlset([
        urlEntry("/"),
        ...categories.map((row) => urlEntry(`/category/${encodeURIComponent(row.slug)}`, row.lastmod)),
        ...tags.map((row) => urlEntry(`/tag/${encodeURIComponent(row.slug)}`, row.lastmod)),
        ...authors.map((row) => urlEntry(`/u/${encodeURIComponent(row.username)}`, row.lastmod)),
    ]);
};

// file n of the stories; one past the last (or below 1) is "not found"
export const sitemapPosts = async (n) => {
    const total = await countPublished();
    if (!Number.isInteger(n) || n < 1 || n > Math.max(1, Math.ceil(total / SITEMAP_CHUNK))) throw new NotFoundError("Not found");
    const rows = await listPublishedForSitemap({ limit: SITEMAP_CHUNK, offset: (n - 1) * SITEMAP_CHUNK });
    return urlset(rows.map((row) => urlEntry(`/blog/${encodeURIComponent(row.slug)}`, row.updatedAt)));
};

// ---------- RSS feeds ----------

const FEED_NAMESPACES = {
    version: "2.0",
    "xmlns:atom": "http://www.w3.org/2005/Atom",
    "xmlns:content": "http://purl.org/rss/1.0/modules/content/",
    "xmlns:dc": "http://purl.org/dc/elements/1.1/",
};

// the sanitized story HTML, sanitized once more on its way out (cheap, and a legacy row can never leak markup)
const safeBody = (row) => {
    try {
        return sanitizeContent(row.content);
    } catch {
        return `<p>${escapeHtml(row.contentText ?? htmlToText(row.content))}</p>`;
    }
};

const storyPath = (post) => `/blog/${encodeURIComponent(post.slug)}`;

// kind: "site" | "author" | "category" | "tag"; an unknown author (or one without a public profile), section or topic is "not found"
export const feed = async (kind, name) => {
    const filter = {};
    let title = env.SITE_NAME;
    let description = env.SITE_DESCRIPTION;
    let selfPath = "/feed.xml";
    let linkPath = "/";

    if (kind === "author") {
        const user = await findUserByUsername(name);
        if (!user || user.status !== "active") throw new NotFoundError("Not found");
        filter.userId = user.id;
        title = `${user.username} — ${env.SITE_NAME}`;
        description = `Stories by ${user.username}`;
        selfPath = `/feed/author/${encodeURIComponent(user.username)}.xml`;
        linkPath = `/u/${encodeURIComponent(user.username)}`;
    } else if (kind === "category") {
        const category = await findCategoryBySlug(name);
        if (!category) throw new NotFoundError("Not found");
        filter.categoryId = category.id;
        title = `${category.name} — ${env.SITE_NAME}`;
        description = category.description || `Stories in ${category.name}`;
        selfPath = `/feed/category/${encodeURIComponent(category.slug)}.xml`;
        linkPath = `/category/${encodeURIComponent(category.slug)}`;
    } else if (kind === "tag") {
        const tag = await findTagBySlug(name);
        if (!tag) throw new NotFoundError("Not found");
        filter.tagId = tag.id;
        title = `${tag.name} — ${env.SITE_NAME}`;
        description = `Stories tagged ${tag.name}`;
        selfPath = `/feed/tag/${encodeURIComponent(tag.slug)}.xml`;
        linkPath = `/tag/${encodeURIComponent(tag.slug)}`;
    }

    const { rows } = await findPublishedPage({ ...filter, limit: FEED_LIMIT, offset: 0 });
    await attachTags(rows);
    const bodies = new Map((await findContentsByIds(rows.map((row) => row.id))).map((row) => [row.id, row]));

    const items = rows.map((post) => {
        const link = siteUrl(storyPath(post));
        const preview = toPreview(post);
        return groupElement("item", [
            textElement("title", post.title),
            textElement("link", link),
            textElement("guid", link, { isPermaLink: "true" }),
            textElement("pubDate", new Date(post.publishedAt).toUTCString()),
            textElement("dc:creator", preview.author?.username ?? ""),
            ...(post.category ? [textElement("category", post.category.name)] : []),
            ...(post.tagList ?? []).map((tag) => textElement("category", tag.name)),
            textElement("description", post.excerpt ?? ""),
            textElement("content:encoded", bodies.has(post.id) ? safeBody(bodies.get(post.id)) : ""),
        ]);
    });
    const newest = rows[0]?.publishedAt;
    const channel = groupElement("channel", [
        textElement("title", title),
        textElement("link", siteUrl(linkPath)),
        textElement("description", description),
        textElement("language", "en"),
        ...(newest ? [textElement("lastBuildDate", new Date(newest).toUTCString())] : []),
        emptyElement("atom:link", { href: siteUrl(selfPath), rel: "self", type: "application/rss+xml" }),
        ...items,
    ]);
    return `${XML_DECLARATION}\n${groupElement("rss", [channel], FEED_NAMESPACES)}\n`;
};

// ---------- HTML snapshots ----------

const dateText = (value) => new Date(value).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const authorLink = (author) =>
    author && !author.deleted ? `<a href="${escapeHtml(siteUrl(`/u/${encodeURIComponent(author.username)}`))}">${escapeHtml(author.username)}</a>` : escapeHtml(author?.username ?? "");

const breadcrumbs = (trail) => ({
    "@type": "BreadcrumbList",
    itemListElement: trail.map(([name, path], index) => ({ "@type": "ListItem", position: index + 1, name, item: siteUrl(path) })),
});

const publisher = () => ({ "@type": "Organization", name: env.SITE_NAME, url: siteUrl("/") });

const pageOf = (query) => {
    const page = Number.parseInt(query?.page, 10);
    return Number.isInteger(page) && page >= 1 ? Math.min(page, SNAPSHOT_MAX_PAGE) : 1;
};

const withPage = (path, page) => (page > 1 ? `${path}?page=${page}` : path);

// A list page (front page, a section, a topic, an author): one page of previews with real links and prev/next.
// Returns null for a page past the last one.
const listSnapshot = async ({ path, query, filter, title, description, type = "website", intro = "", extraJsonLd = [], trail }) => {
    const page = pageOf(query);
    const { rows, count } = await findPublishedPage({ ...filter, limit: SNAPSHOT_PAGE_SIZE, offset: (page - 1) * SNAPSHOT_PAGE_SIZE });
    const totalPages = Math.max(1, Math.ceil(count / SNAPSHOT_PAGE_SIZE));
    if (page > totalPages) return null;
    // a section, topic or profile with nothing published is not worth indexing (the front page always is)
    const robots = count === 0 && path !== "/" ? "noindex,follow" : "index,follow";

    const previews = rows.map(toPreview);
    const items = previews
        .map(
            (post) =>
                `<li><h2><a href="${escapeHtml(siteUrl(storyPath(post)))}">${escapeHtml(post.title)}</a></h2>` +
                (post.excerpt ? `<p>${escapeHtml(post.excerpt)}</p>` : "") +
                `<p>${post.author ? `By ${authorLink(post.author)} · ` : ""}<time datetime="${escapeHtml(iso(post.publishedAt))}">${escapeHtml(dateText(post.publishedAt))}</time></p></li>`,
        )
        .join("\n");
    const nav = [
        page > 1 ? `<a rel="prev" href="${escapeHtml(siteUrl(withPage(path, page - 1)))}">Newer stories</a>` : "",
        page < totalPages ? `<a rel="next" href="${escapeHtml(siteUrl(withPage(path, page + 1)))}">Older stories</a>` : "",
    ]
        .filter(Boolean)
        .join(" · ");

    return {
        robots,
        html: renderSnapshot({
            title,
            description,
            canonical: siteUrl(withPage(path, page)),
            type,
            robots,
            prev: page > 1 ? siteUrl(withPage(path, page - 1)) : null,
            next: page < totalPages ? siteUrl(withPage(path, page + 1)) : null,
            jsonLd: {
                "@context": "https://schema.org",
                "@graph": [
                    { "@type": "CollectionPage", name: title, description, url: siteUrl(withPage(path, page)), isPartOf: { "@type": "WebSite", name: env.SITE_NAME, url: siteUrl("/") } },
                    {
                        "@type": "ItemList",
                        itemListElement: previews.map((post, index) => ({ "@type": "ListItem", position: (page - 1) * SNAPSHOT_PAGE_SIZE + index + 1, url: siteUrl(storyPath(post)) })),
                    },
                    ...(trail ? [breadcrumbs(trail)] : []),
                    ...extraJsonLd,
                ],
            },
            bodyHtml: `<h1>${escapeHtml(title)}</h1>\n${intro}${previews.length ? `<ol>\n${items}\n</ol>` : "<p>Nothing has been published here yet.</p>"}\n${nav ? `<nav>${nav}</nav>` : ""}`,
        }),
    };
};

export const homeSnapshot = (query) =>
    listSnapshot({
        path: "/",
        query,
        filter: {},
        title: env.SITE_NAME,
        description: env.SITE_DESCRIPTION,
        extraJsonLd: [{ "@type": "WebSite", name: env.SITE_NAME, url: siteUrl("/"), description: env.SITE_DESCRIPTION, publisher: publisher() }],
    });

export const categorySnapshot = async (slug, query) => {
    const category = await findCategoryBySlug(slug);
    if (!category) return null;
    const path = `/category/${encodeURIComponent(category.slug)}`;
    return listSnapshot({
        path,
        query,
        filter: { categoryId: category.id },
        title: category.name,
        description: describe(category.description || `Stories in ${category.name} on ${env.SITE_NAME}.`),
        trail: [[env.SITE_NAME, "/"], [category.name, path]],
    });
};

export const tagSnapshot = async (slug, query) => {
    const tag = await findTagBySlug(slug);
    if (!tag) return null;
    const path = `/tag/${encodeURIComponent(tag.slug)}`;
    return listSnapshot({
        path,
        query,
        filter: { tagId: tag.id },
        title: `#${tag.name}`,
        description: describe(`Stories tagged ${tag.name} on ${env.SITE_NAME}.`),
        trail: [[env.SITE_NAME, "/"], [`#${tag.name}`, path]],
    });
};

export const profileSnapshot = async (username, query) => {
    const user = await findUserByUsername(username, { withAvatar: true });
    // only active accounts have a public profile; deleted and suspended ones look like they do not exist
    if (!user || user.status !== "active") return null;
    const path = `/u/${encodeURIComponent(user.username)}`;
    const links = Object.values(user.socialLinks ?? {}).filter((value) => typeof value === "string" && value.startsWith("https://"));
    const bio = user.bio ? `<p>${escapeHtml(user.bio)}</p>\n` : "";
    return listSnapshot({
        path,
        query,
        filter: { userId: user.id },
        title: user.username,
        description: describe(user.bio || `Stories by ${user.username} on ${env.SITE_NAME}.`),
        type: "profile",
        intro: bio,
        extraJsonLd: [
            {
                "@type": "Person",
                name: user.username,
                url: siteUrl(path),
                ...(avatarUrlOf(user) && absoluteUrl(avatarUrlOf(user)) && { image: absoluteUrl(avatarUrlOf(user)) }),
                ...(user.bio && { description: user.bio }),
                ...(links.length && { sameAs: links }),
            },
        ],
        trail: [[env.SITE_NAME, "/"], [user.username, path]],
    });
};

// One published story (visible to everyone, whoever its author is today). Anything else is null.
export const storySnapshot = async (slug) => {
    const post = await findPostBySlug(slug);
    if (!post || post.status !== "published") return null;
    await attachTags([post]);
    const story = toPostDto(post);

    const path = storyPath(story);
    const canonical = siteUrl(path);
    const image = story.cover ? absoluteUrl(story.cover.url) : null;
    const description = describe(story.excerpt);
    const author = story.author;
    const authorUrl = author && !author.deleted ? siteUrl(`/u/${encodeURIComponent(author.username)}`) : null;
    const tags = story.tags.map((tag) => tag.name);
    const body = safeBody(post);

    const links = [
        story.category ? `Section: <a href="${escapeHtml(siteUrl(`/category/${encodeURIComponent(story.category.slug)}`))}">${escapeHtml(story.category.name)}</a>` : "",
        story.tags.length
            ? `Topics: ${story.tags.map((tag) => `<a href="${escapeHtml(siteUrl(`/tag/${encodeURIComponent(tag.slug)}`))}">${escapeHtml(tag.name)}</a>`).join(", ")}`
            : "",
    ]
        .filter(Boolean)
        .map((line) => `<p>${line}</p>`)
        .join("\n");

    return {
        robots: "index,follow",
        html: renderSnapshot({
            title: story.title,
            description,
            canonical,
            image,
            imageAlt: story.cover?.alt ?? "",
            type: "article",
            article: { published: iso(story.publishedAt), modified: iso(story.updatedAt), authorUrl, tags },
            jsonLd: {
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "BlogPosting",
                        headline: story.title,
                        description,
                        datePublished: iso(story.publishedAt),
                        dateModified: iso(story.updatedAt),
                        mainEntityOfPage: canonical,
                        url: canonical,
                        ...(image && { image: [image] }),
                        ...(author && { author: { "@type": "Person", name: author.username, ...(authorUrl && { url: authorUrl }) } }),
                        publisher: publisher(),
                        ...(story.category && { articleSection: story.category.name }),
                        ...(tags.length && { keywords: tags.join(", ") }),
                    },
                    breadcrumbs([
                        [env.SITE_NAME, "/"],
                        ...(story.category ? [[story.category.name, `/category/${encodeURIComponent(story.category.slug)}`]] : []),
                        [story.title, path],
                    ]),
                ],
            },
            bodyHtml:
                `<article>\n<h1>${escapeHtml(story.title)}</h1>\n` +
                `<p>${author ? `By ${authorLink(author)} · ` : ""}<time datetime="${escapeHtml(iso(story.publishedAt))}">${escapeHtml(dateText(story.publishedAt))}</time> · ${escapeHtml(story.readingTime)} min read</p>\n` +
                (image ? `<figure><img src="${escapeHtml(image)}" alt="${escapeHtml(story.cover?.alt ?? "")}"></figure>\n` : "") +
                `${body}\n${links}\n</article>`,
        }),
    };
};
