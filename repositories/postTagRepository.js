import { Op } from "sequelize";
import { PostTag, Tag } from "../database/models/index.js";

// Make `tagIds` exactly the set of tags the post carries: remove the others, add the missing ones.
export const replacePostTags = async (postId, tagIds, options = {}) => {
    await PostTag.destroy({
        where: tagIds.length ? { postId, tagId: { [Op.notIn]: tagIds } } : { postId },
        ...options,
    });
    if (tagIds.length) {
        await PostTag.bulkCreate(tagIds.map((tagId) => ({ postId, tagId })), { ignoreDuplicates: true, ...options });
    }
};

// the tags of many posts in one query: Map(postId -> [{ name, slug }]), alphabetical
export const findTagsForPosts = async (postIds) => {
    const byPost = new Map();
    if (postIds.length === 0) return byPost;
    const rows = await PostTag.findAll({
        where: { postId: postIds },
        include: [{ model: Tag, as: "tag", attributes: ["name", "slug"] }],
    });
    for (const row of rows) {
        if (!byPost.has(row.postId)) byPost.set(row.postId, []);
        byPost.get(row.postId).push({ name: row.tag.name, slug: row.tag.slug });
    }
    for (const tags of byPost.values()) tags.sort((a, b) => a.name.localeCompare(b.name));
    return byPost;
};
