import { QueryTypes } from "sequelize";
import sequelize from "../database/dbconnection.js";
import { Post } from "../database/models/index.js";

// Small, body-free reads for sitemaps and feeds. Everything here is already restricted to what the public may see.

export const countPublished = async () => Post.count({ where: { status: "published" } });

// one page of a sitemap: published stories in a stable order
export const listPublishedForSitemap = async ({ limit, offset }) =>
    Post.findAll({ where: { status: "published" }, attributes: ["id", "slug", "updatedAt"], order: [["id", "ASC"]], limit, offset, raw: true });

// The next three list what has at least one published story, with the newest publication time (the sitemap's lastmod).
export const listCategoriesWithPublished = async (limit) =>
    sequelize.query(
        "SELECT c.slug AS slug, MAX(p.publishedAt) AS lastmod FROM `categories` c JOIN `Posts` p ON p.categoryId = c.id AND p.status = 'published' " +
            "GROUP BY c.id, c.slug ORDER BY c.slug ASC LIMIT :limit",
        { replacements: { limit }, type: QueryTypes.SELECT },
    );

export const listTagsWithPublished = async (limit) =>
    sequelize.query(
        "SELECT t.slug AS slug, MAX(p.publishedAt) AS lastmod FROM `tags` t JOIN `post_tags` pt ON pt.tagId = t.id " +
            "JOIN `Posts` p ON p.id = pt.postId AND p.status = 'published' GROUP BY t.id, t.slug ORDER BY t.slug ASC LIMIT :limit",
        { replacements: { limit }, type: QueryTypes.SELECT },
    );

// only active accounts have a public profile
export const listAuthorsWithPublished = async (limit) =>
    sequelize.query(
        "SELECT u.username AS username, MAX(p.publishedAt) AS lastmod FROM `Users` u JOIN `Posts` p ON p.userId = u.id AND p.status = 'published' " +
            "WHERE u.status = 'active' GROUP BY u.id, u.username ORDER BY u.username ASC LIMIT :limit",
        { replacements: { limit }, type: QueryTypes.SELECT },
    );

// the bodies of a few posts (the feed lists carry no bodies), by id
export const findContentsByIds = async (ids) =>
    ids.length === 0 ? [] : Post.findAll({ where: { id: ids, status: "published" }, attributes: ["id", "content", "contentText"], raw: true });
