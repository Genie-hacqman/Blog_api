import { Op } from "sequelize";
import { PostMedia } from "../database/models/index.js";

// Make `mediaIds` exactly the set of inline images the post uses: remove the others, add the missing ones.
export const replacePostMedia = async (postId, mediaIds, options = {}) => {
    await PostMedia.destroy({
        where: mediaIds.length ? { postId, mediaId: { [Op.notIn]: mediaIds } } : { postId },
        ...options,
    });
    if (mediaIds.length) {
        await PostMedia.bulkCreate(mediaIds.map((mediaId) => ({ postId, mediaId })), { ignoreDuplicates: true, ...options });
    }
};
