import express from "express";
import { env } from "../config/env.js";
import * as controller from "../controllers/seoController.js";
import { seoRateLimiter } from "../middleware/rateLimiter.js";
import { NotFoundError } from "../utils/AppError.js";

const router = express.Router();

// the switch: with SEO_ENABLED=false none of these exist
const enabled = (req, res, next) => (env.SEO_ENABLED ? next() : next(new NotFoundError("Not found")));

// robots.txt, sitemaps and feeds are fetched at the site's own address (the frontend host proxies them here)
router.get("/robots.txt", enabled, seoRateLimiter, controller.robots);
router.get("/sitemap.xml", enabled, seoRateLimiter, controller.sitemapIndex);
router.get("/sitemap-pages.xml", enabled, seoRateLimiter, controller.sitemapPages);
router.get("/sitemap-posts-:n.xml", enabled, seoRateLimiter, controller.sitemapPosts);
router.get("/feed.xml", enabled, seoRateLimiter, controller.siteFeed);
router.get("/feed/author/:name", enabled, seoRateLimiter, controller.kindFeed("author"));
router.get("/feed/category/:name", enabled, seoRateLimiter, controller.kindFeed("category"));
router.get("/feed/tag/:name", enabled, seoRateLimiter, controller.kindFeed("tag"));

// the HTML snapshots of public pages, for crawlers that do not run the app
router.get("/api/seo/home", enabled, seoRateLimiter, controller.homePage);
router.get("/api/seo/blog/:slug", enabled, seoRateLimiter, controller.storyPage);
router.get("/api/seo/u/:username", enabled, seoRateLimiter, controller.profilePage);
router.get("/api/seo/category/:slug", enabled, seoRateLimiter, controller.categoryPage);
router.get("/api/seo/tag/:slug", enabled, seoRateLimiter, controller.tagPage);

export default router;
