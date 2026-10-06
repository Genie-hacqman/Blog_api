import { literal, Op } from "sequelize";
import { Media, Post, PostMedia } from "../database/models/index.js";

export const createMedia = async (data, options = {}) => Media.create(data, options);

// a live (not deleted) item that belongs to ownerId, or null
export const findOwnedMedia = async (id, ownerId) => Media.findOne({ where: { id, ownerId, deletedAt: null } });

export const findMediaById = async (id) => Media.findOne({ where: { id, deletedAt: null } });

export const softDeleteMedia = async (id) => {
    const [count] = await Media.update({ deletedAt: new Date() }, { where: { id, deletedAt: null } });
    return count;
};

// used only to undo a row whose file never reached storage
export const destroyMedia = async (id) => Media.destroy({ where: { id } });

export const countUploadsSince = async (ownerId, since) =>
    Media.count({ where: { ownerId, createdAt: { [Op.gte]: since } } });

// the live images of one purpose that belong to ownerId, by id (a cover must be the owner's own cover upload)
export const findOwnedMediaByIds = async (ids, ownerId, purpose) =>
    ids.length === 0 ? [] : Media.findAll({ where: { id: ids, ownerId, purpose, deletedAt: null } });

// the live images with these storage keys that belong to ownerId (an inline image is recognized by its key)
export const findOwnedMediaByKeys = async (keys, ownerId, purpose) =>
    keys.length === 0 ? [] : Media.findAll({ where: { key: keys, ownerId, purpose, deletedAt: null } });

// is a post using this image, as its cover or inline?
export const isMediaReferenced = async (id, options = {}) =>
    (await Post.count({ where: { coverMediaId: id }, ...options })) > 0 || (await PostMedia.count({ where: { mediaId: id }, ...options })) > 0;

// cover and inline images older than `before` that no post uses (oldest first)
export const findUnreferencedMedia = async ({ before, limit }) =>
    Media.findAll({
        where: {
            deletedAt: null,
            purpose: { [Op.in]: ["cover", "inline"] },
            createdAt: { [Op.lt]: before },
            [Op.and]: [
                literal("`Media`.`id` NOT IN (SELECT mediaId FROM `post_media`)"),
                literal("`Media`.`id` NOT IN (SELECT coverMediaId FROM `Posts` WHERE coverMediaId IS NOT NULL)"),
            ],
        },
        order: [["createdAt", "ASC"], ["id", "ASC"]],
        limit,
    });
