import { fn, literal, Op } from "sequelize";
import { Comment, Media, Post, User } from "../database/models/index.js";

// who wrote it: id, name and status (deleted accounts are shown generically) and the photo's key for the URL
const authorInclude = {
    model: User,
    as: "author",
    attributes: ["id", "username", "status"],
    include: [{ model: Media, as: "avatar", attributes: ["id", "key"] }],
};

// the post a comment belongs to, as much as the rules need (visibility and who may delete)
const postInclude = { model: Post, as: "post", attributes: ["id", "userId", "status"] };

export const findCommentById = async (id, options = {}) => Comment.findByPk(id, { include: [authorInclude, postInclude], ...options });

// a top-level comment is listed while it is live, or while at least one live reply still hangs under it
const LISTED = literal("`Comment`.`deletedAt` IS NULL OR EXISTS (SELECT 1 FROM `comments` r WHERE r.`parentId` = `Comment`.`id` AND r.`deletedAt` IS NULL)");

// top-level comments of a post, newest first (id breaks ties so paging is stable)
export const findTopLevelPage = async ({ postId, limit, offset }) => {
    const where = { postId, parentId: null, [Op.and]: [LISTED] };
    const [rows, count] = await Promise.all([
        Comment.findAll({ where, include: [authorInclude], order: [["createdAt", "DESC"], ["id", "DESC"]], limit, offset }),
        Comment.count({ where }),
    ]);
    return { rows, count };
};

// replies under one comment, oldest first (a conversation reads forwards)
export const findRepliesPage = async ({ parentId, limit, offset }) => {
    const where = { parentId, deletedAt: null };
    const [rows, count] = await Promise.all([
        Comment.findAll({ where, include: [authorInclude], order: [["createdAt", "ASC"], ["id", "ASC"]], limit, offset }),
        Comment.count({ where }),
    ]);
    return { rows, count };
};

// live replies per comment, in one query: Map(commentId -> count)
export const countRepliesFor = async (parentIds) => {
    const counts = new Map();
    if (parentIds.length === 0) return counts;
    const rows = await Comment.findAll({
        attributes: ["parentId", [fn("COUNT", literal("*")), "n"]],
        where: { parentId: parentIds, deletedAt: null },
        group: ["parentId"],
        raw: true,
    });
    for (const row of rows) counts.set(row.parentId, Number(row.n));
    return counts;
};

// live comments (replies included) per post, in one query: Map(postId -> count)
export const countCommentsForPosts = async (postIds) => {
    const counts = new Map();
    if (postIds.length === 0) return counts;
    const rows = await Comment.findAll({
        attributes: ["postId", [fn("COUNT", literal("*")), "n"]],
        where: { postId: postIds, deletedAt: null },
        group: ["postId"],
        raw: true,
    });
    for (const row of rows) counts.set(row.postId, Number(row.n));
    return counts;
};

// a few columns of many comments, for building the inbox
export const findCommentsByIds = async (ids) =>
    ids.length === 0 ? [] : Comment.findAll({ where: { id: ids }, attributes: ["id", "parentId", "postId", "userId", "body", "deletedAt"] });

export const createComment = async (data, options = {}) => {
    const comment = await Comment.create(data, options);
    return findCommentById(comment.id, options);
};

export const updateCommentBody = async (id, body, editedAt, options = {}) => {
    const [count] = await Comment.update({ body, editedAt }, { where: { id, deletedAt: null }, ...options });
    return count;
};

// the row stays (replies hang under it); the words are gone
export const softDeleteComment = async (id, options = {}) => {
    const [count] = await Comment.update({ body: null, deletedAt: new Date() }, { where: { id, deletedAt: null }, ...options });
    return count;
};

export const countCommentsByUserSince = async (userId, since) => Comment.count({ where: { userId, createdAt: { [Op.gte]: since } } });

// account deletion: everything the person wrote becomes a placeholder
export const wipeCommentsByUser = async (userId, options = {}) => {
    const [count] = await Comment.update({ body: null, deletedAt: new Date() }, { where: { userId, deletedAt: null }, ...options });
    return count;
};
