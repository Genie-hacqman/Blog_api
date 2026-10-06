import { Bookmark, Post } from "../database/models/index.js";

export const addBookmark = async (userId, postId) => {
    await Bookmark.bulkCreate([{ userId, postId }], { ignoreDuplicates: true });
};

export const removeBookmark = async (userId, postId) => Bookmark.destroy({ where: { userId, postId } });

export const hasBookmarked = async (userId, postId) => Boolean(await Bookmark.findOne({ where: { userId, postId }, attributes: ["postId"] }));

// One person's saved posts, most recently saved first. Only posts that are published right now count: a
// bookmark of a post that was pulled stays in the table (it comes back if the post does) but is not listed.
export const findBookmarkPage = async ({ userId, limit, offset }) => {
    const { rows, count } = await Bookmark.findAndCountAll({
        where: { userId },
        include: [{ model: Post, as: "post", attributes: ["id"], required: true, where: { status: "published" } }],
        order: [["createdAt", "DESC"], ["postId", "DESC"]],
        limit,
        offset,
    });
    return { postIds: rows.map((row) => row.postId), count };
};

export const removeBookmarksByUser = async (userId, options = {}) => Bookmark.destroy({ where: { userId }, ...options });
