import { CACHE_SECONDS } from "../config/seo.js";
import * as seo from "../services/seoService.js";
import { renderNotFound } from "../views/snapshot.js";
import { NotFoundError } from "../utils/AppError.js";

// Plain responses for crawlers: XML, text or HTML, never the JSON envelope (apart from the ordinary 404 of the
// feeds and sitemaps). Everything is cacheable by browsers and the host's CDN for a few minutes to an hour.

const cached = (res, type, seconds, body) =>
    res
        .set("Content-Type", type)
        .set("Cache-Control", `public, max-age=${seconds}, s-maxage=${seconds}`)
        .send(body);

const XML = "application/xml; charset=utf-8";

export const robots = (req, res) => cached(res, "text/plain; charset=utf-8", CACHE_SECONDS.robots, seo.robotsTxt());

export const sitemapIndex = async (req, res) => cached(res, XML, CACHE_SECONDS.sitemap, await seo.sitemapIndex());
export const sitemapPages = async (req, res) => cached(res, XML, CACHE_SECONDS.sitemap, await seo.sitemapPages());
export const sitemapPosts = async (req, res) => cached(res, XML, CACHE_SECONDS.sitemap, await seo.sitemapPosts(Number(req.params.n)));

export const siteFeed = async (req, res) => cached(res, "application/rss+xml; charset=utf-8", CACHE_SECONDS.feed, await seo.feed("site"));

// /feed/<kind>/<name>.xml (the name must end in .xml; usernames and slugs cannot contain a dot)
export const kindFeed = (kind) => async (req, res) => {
    const match = /^(.+)\.xml$/.exec(req.params.name);
    if (!match) throw new NotFoundError("Not found");
    return cached(res, "application/rss+xml; charset=utf-8", CACHE_SECONDS.feed, await seo.feed(kind, match[1]));
};

// a snapshot answers 200 with the page, or a real 404 with the same "not found" page whatever the reason
const snapshot = (build) => async (req, res) => {
    const result = await build(req);
    if (!result) {
        return res.status(404).set("Content-Type", "text/html; charset=utf-8").set("Cache-Control", `public, max-age=${CACHE_SECONDS.missing}`).set("X-Robots-Tag", "noindex").send(renderNotFound());
    }
    if (result.robots.startsWith("noindex")) res.set("X-Robots-Tag", "noindex");
    return cached(res, "text/html; charset=utf-8", CACHE_SECONDS.snapshot, result.html);
};

export const homePage = snapshot((req) => seo.homeSnapshot(req.query));
export const storyPage = snapshot((req) => seo.storySnapshot(req.params.slug));
export const profilePage = snapshot((req) => seo.profileSnapshot(req.params.username, req.query));
export const categoryPage = snapshot((req) => seo.categorySnapshot(req.params.slug, req.query));
export const tagPage = snapshot((req) => seo.tagSnapshot(req.params.slug, req.query));
