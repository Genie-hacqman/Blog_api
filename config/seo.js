// Search-engine and link-preview support: limits, cache times and what crawlers are told to stay away from.
// The frontend's SITE_NAME / SITE_TAGLINE (src/components/site.js) default to the same words as the env defaults in config/env.js.

// how many addresses go into one sitemap file (the format allows 50,000; smaller files are cheaper to build and fetch)
export const SITEMAP_CHUNK = 5000;
// stories in an RSS feed
export const FEED_LIMIT = 30;
// stories on a page of a crawler snapshot (the same as the front page)
export const SNAPSHOT_PAGE_SIZE = 10;
export const SNAPSHOT_MAX_PAGE = 100;
// search results show about this much of a description
export const DESCRIPTION_MAX = 160;

// seconds a response may be reused by browsers and the host's CDN
export const CACHE_SECONDS = Object.freeze({ sitemap: 3600, robots: 3600, feed: 900, snapshot: 300, missing: 60 });

// paths of the app that are for signed-in people or have no value in a search engine; robots.txt asks crawlers to skip them
// (`$` and `*` are part of the standard, RFC 9309). The pages also say `noindex` themselves.
export const DISALLOWED_PATHS = Object.freeze([
    "/api/",
    "/me/",
    "/admin",
    "/settings",
    "/posts/",
    "/manage/",
    "/moderation",
    "/review",
    "/notifications",
    "/account/",
    "/search",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/unsubscribe",
    // the signed-in "Following" page is /feed; the RSS feeds are /feed.xml and /feed/...
    "/feed$",
    "/u/*/followers",
    "/u/*/following",
]);

// the picture used when a story has no cover (served by the frontend host)
export const DEFAULT_IMAGE_PATH = "/og-default.png";
