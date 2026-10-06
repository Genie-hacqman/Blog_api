import { fn, literal } from "sequelize";
import { PostLike } from "../database/models/index.js";

// idempotent: liking twice is liking once (the composite key ignores the second insert)
export const addLike = async (postId, userId) => {
    await PostLike.bulkCreate([{ postId, userId }], { ignoreDuplicates: true });
};

export const removeLike = async (postId, userId) => PostLike.destroy({ where: { postId, userId } });

export const countLikes = async (postId) => PostLike.count({ where: { postId } });

// likes per post, in one query: Map(postId -> count)
export const countLikesForPosts = async (postIds) => {
    const counts = new Map();
    if (postIds.length === 0) return counts;
    const rows = await PostLike.findAll({ attributes: ["postId", [fn("COUNT", literal("*")), "n"]], where: { postId: postIds }, group: ["postId"], raw: true });
    for (const row of rows) counts.set(row.postId, Number(row.n));
    return counts;
};

export const hasLiked = async (postId, userId) => Boolean(await PostLike.findOne({ where: { postId, userId }, attributes: ["postId"] }));

export const removeLikesByUser = async (userId, options = {}) => PostLike.destroy({ where: { userId }, ...options });
