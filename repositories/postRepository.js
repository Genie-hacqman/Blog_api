import { literal, Op } from "sequelize";
import { Category, Media, Post, User } from "../database/models/index.js";

// status is included so deleted accounts can be shown generically; the avatar key builds the photo URL
const authorInclude = {
    model: User,
    as: "author",
    attributes: ["id", "username", "status"],
    include: [{ model: Media, as: "avatar", attributes: ["id", "key"] }],
};

// a post's section, for display (id, name and slug only)
const categoryInclude = { model: Category, as: "category", attributes: ["id", "name", "slug"] };

// a post's cover image (a deleted image is simply "no cover")
const coverInclude = { model: Media, as: "cover", attributes: ["id", "key", "width", "height"], where: { deletedAt: null }, required: false };

// lists and previews never need the (potentially large) body
const withoutContent = { exclude: ["content", "contentText"] };

export const createPost = async (data, options = {}) => {
    const post = await Post.create(data, options);
    return findPostById(post.id, options);
};

export const findPostById = async (id, options = {}) => Post.findByPk(id, { include: [authorInclude, categoryInclude, coverInclude], ...options });

export const findPostBySlug = async (slug) => Post.findOne({ where: { slug }, include: [authorInclude, categoryInclude, coverInclude] });

// Lock the row for the rest of the transaction without joining other tables. Used by every
// operation that reads a post, decides, then writes, so two requests cannot both act on the old state.
export const lockPostById = async (id, transaction) =>
    Post.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });

export const slugExists = async (slug, { excludeId, transaction } = {}) => {
    const post = await Post.findOne({ where: { slug }, attributes: ["id"], transaction });
    return Boolean(post) && post.id !== excludeId;
};

// published posts, newest first (publish time, then id so pagination is stable); optional author, section and tag filters
export const findPublishedPage = async ({ userId, followedBy, categoryId, tagId, limit, offset }) =>
    Post.findAndCountAll({
        where: {
            status: "published",
            ...(userId && { userId }),
            // followedBy is a user id from the session, never from the request: the posts of the people that user follows
            ...(followedBy && { userId: { [Op.in]: literal(`(SELECT followingId FROM follows WHERE followerId = ${Number(followedBy)})`) } }),
            ...(categoryId && { categoryId }),
            // tagId is an integer that came from our own tags table, never from the request
            ...(tagId && { id: { [Op.in]: literal(`(SELECT postId FROM post_tags WHERE tagId = ${Number(tagId)})`) } }),
        },
        attributes: withoutContent,
        include: [authorInclude, categoryInclude, coverInclude],
        order: [["publishedAt", "DESC"], ["id", "DESC"]],
        limit,
        offset,
    });

// everything an author owns, optionally one status, most recently touched first
export const findPostsByOwner = async ({ userId, status, limit, offset }) =>
    Post.findAndCountAll({
        where: { userId, ...(status && { status }) },
        attributes: withoutContent,
        include: [authorInclude, categoryInclude, coverInclude],
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
        limit,
        offset,
    });

// the review queue: oldest submission first
export const findPostsByStatus = async ({ status, limit, offset }) =>
    Post.findAndCountAll({
        where: { status },
        attributes: withoutContent,
        include: [authorInclude, categoryInclude, coverInclude],
        order: [["updatedAt", "ASC"], ["id", "ASC"]],
        limit,
        offset,
    });

// Owner-scoped content write: the owner is part of the condition, so ownership cannot be
// swapped between the permission check and the write. Returns the number of rows changed.
export const updatePostForOwner = async (id, userId, data, options = {}) => {
    const [count] = await Post.update(data, { where: { id, userId }, ...options });
    return count;
};

// Status change guarded by the status the caller saw: if another request moved the post in the
// meantime the condition no longer matches and nothing is written (count 0).
export const transitionPost = async (id, fromStatus, data, options = {}) => {
    const [count] = await Post.update(data, { where: { id, status: fromStatus }, ...options });
    return count;
};

// delete a post that belongs to userId; returns the number of rows removed
export const deletePostById = async (id, userId) => {
    return await Post.destroy({ where: { id, userId } });
};

// a few columns of many posts, for building the inbox
export const findPostsByIds = async (ids) =>
    ids.length === 0 ? [] : Post.findAll({ where: { id: ids }, attributes: ["id", "slug", "title", "userId", "status", "rejectionReason", "readingTime"] });

// published posts by one author (profile page counter)
export const countPublishedByUser = async (userId) => Post.count({ where: { userId, status: "published" } });

// account deletion removes the author's unpublished work (drafts, reviews, scheduled, private,
// archived); published posts stay, anonymized
export const deleteUnpublishedByUser = async (userId, options = {}) =>
    Post.destroy({ where: { userId, status: { [Op.ne]: "published" } }, ...options });

// scheduled posts whose time has come. SKIP LOCKED lets several app instances run the job at
// once: each takes a different batch and none waits for another.
export const findDueScheduledPosts = async (now, limit, transaction) =>
    Post.findAll({
        // a suspended or deleted author's story waits until they are active again
        where: { status: "scheduled", scheduledAt: { [Op.lte]: now }, userId: { [Op.in]: literal("(SELECT `id` FROM `Users` WHERE `status` = 'active')") } },
        order: [["scheduledAt", "ASC"], ["id", "ASC"]],
        limit,
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
    });

// Published posts by id, in the order of `ids` (the order a search engine ranked them). Anything that is
// not published right now is left out, whatever the engine believed.
export const findPublishedByIds = async (ids) => {
    if (ids.length === 0) return [];
    const posts = await Post.findAll({
        where: { id: ids, status: "published" },
        attributes: withoutContent,
        include: [authorInclude, categoryInclude, coverInclude],
    });
    const byId = new Map(posts.map((post) => [post.id, post]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
};
