import { QueryTypes } from "sequelize";
import sequelize from "../database/dbconnection.js";
import { escapeLike, needsTitleFallback } from "../utils/searchQuery.js";

// The only place with full-text SQL. Every piece of user input arrives as a bound parameter
// (`:name` placeholders); the SQL text itself is assembled only from the fixed fragments below.
//
// Relevance = a title match counts 3x a body match, a tag whose slug equals a search word adds 2,
// and an author whose username equals a search word adds 1.5. Only published posts are searched.
const TITLE_MATCH = "MATCH(p.title) AGAINST(:fulltext IN NATURAL LANGUAGE MODE)";
// the plain text of the post: markup, class names and URLs are never matched
const BODY_MATCH = "MATCH(p.excerpt, p.contentText) AGAINST(:fulltext IN NATURAL LANGUAGE MODE)";
const TAG_MATCH =
    "EXISTS (SELECT 1 FROM `post_tags` st JOIN `tags` t ON t.id = st.tagId WHERE st.postId = p.id AND t.slug IN (:tagSlugs))";
const AUTHOR_MATCH = "u.username IN (:usernames)";

export const searchPublishedPosts = async ({ terms, tagSlugs, usernames, titleFallbackFor, categoryId, tagId, sort, limit, offset }) => {
    const replacements = {
        fulltext: terms.join(" "),
        // an empty list would be an SQL syntax error; a value that can never exist matches nothing
        usernames: usernames.length ? usernames : ["-"],
        tagSlugs: tagSlugs.length ? tagSlugs : ["-"],
        limit,
        offset,
    };

    const matchers = [TITLE_MATCH, BODY_MATCH, TAG_MATCH, AUTHOR_MATCH];
    if (needsTitleFallback(terms)) {
        matchers.push("p.title LIKE :like ESCAPE '\\\\'");
        replacements.like = `%${escapeLike(titleFallbackFor)}%`;
    }

    const filters = ["p.status = 'published'", `(${matchers.join(" OR ")})`];
    if (categoryId) {
        filters.push("p.categoryId = :categoryId");
        replacements.categoryId = categoryId;
    }
    if (tagId) {
        filters.push("p.id IN (SELECT postId FROM `post_tags` WHERE tagId = :tagId)");
        replacements.tagId = tagId;
    }
    const where = filters.join(" AND ");
    const from = "FROM `Posts` p JOIN `Users` u ON u.id = p.userId";

    const score = `(3 * ${TITLE_MATCH} + ${BODY_MATCH} + IF(${TAG_MATCH}, 2, 0) + IF(${AUTHOR_MATCH}, 1.5, 0))`;
    const order = sort === "newest" ? "p.publishedAt DESC, p.id DESC" : "score DESC, p.publishedAt DESC, p.id DESC";

    const [rows, [{ total }]] = await Promise.all([
        sequelize.query(`SELECT p.id, ${score} AS score ${from} WHERE ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`, {
            replacements,
            type: QueryTypes.SELECT,
        }),
        sequelize.query(`SELECT COUNT(*) AS total ${from} WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
    ]);

    return { ids: rows.map((row) => row.id), total: Number(total) };
};
