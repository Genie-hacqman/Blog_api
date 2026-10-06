import { QueryTypes } from "sequelize";
import sequelize from "../database/dbconnection.js";
import { Tag } from "../database/models/index.js";
import { escapeLike } from "../utils/searchQuery.js";

export const findTagBySlug = async (slug, options = {}) => Tag.findOne({ where: { slug }, ...options });

export const findTagById = async (id, options = {}) => Tag.findByPk(id, options);

export const findTagsBySlugs = async (slugs, options = {}) => Tag.findAll({ where: { slug: slugs }, ...options });

export const createTag = async (data, options = {}) => Tag.create(data, options);

export const renameTagById = async (id, name, options = {}) => {
    const [count] = await Tag.update({ name }, { where: { id }, ...options });
    return count;
};

export const deleteTagById = async (id, options = {}) => Tag.destroy({ where: { id }, ...options });

// how many published posts carry the tag
export const countPublishedPostsWithTag = async (tagId) => {
    const [row] = await sequelize.query(
        "SELECT COUNT(*) AS total FROM `post_tags` pt JOIN `Posts` p ON p.id = pt.postId AND p.status = 'published' WHERE pt.tagId = :tagId",
        { replacements: { tagId }, type: QueryTypes.SELECT },
    );
    return Number(row.total);
};

export const countPostsWithTag = async (tagId, options = {}) => {
    const [row] = await sequelize.query("SELECT COUNT(*) AS total FROM `post_tags` WHERE tagId = :tagId", {
        replacements: { tagId },
        type: QueryTypes.SELECT,
        ...options,
    });
    return Number(row.total);
};

// Popular tags first, only those used by at least one published post. `prefix` narrows the list for autocomplete.
// The only text in the SQL is fixed; the prefix goes in as a bound parameter with LIKE wildcards neutralised.
export const listPopularTags = async ({ prefix, limit }) => {
    const filter = prefix ? "AND (t.slug LIKE :like ESCAPE '\\\\' OR t.name LIKE :like ESCAPE '\\\\')" : "";
    return sequelize.query(
        "SELECT t.id, t.name, t.slug, COUNT(p.id) AS postCount " +
            "FROM `tags` t JOIN `post_tags` pt ON pt.tagId = t.id JOIN `Posts` p ON p.id = pt.postId AND p.status = 'published' " +
            `WHERE 1 = 1 ${filter} GROUP BY t.id, t.name, t.slug ORDER BY postCount DESC, t.name ASC LIMIT :limit`,
        { replacements: { like: prefix ? `${escapeLike(prefix)}%` : null, limit }, type: QueryTypes.SELECT },
    );
};
