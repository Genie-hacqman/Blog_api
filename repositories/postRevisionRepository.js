import { Op } from "sequelize";
import { PostRevision, User } from "../database/models/index.js";

const editorInclude = { model: User, as: "editor", attributes: ["id", "username"] };

export const createRevision = async (data, options = {}) => PostRevision.create(data, options);

export const findLatestRevision = async (postId, options = {}) =>
    PostRevision.findOne({ where: { postId }, order: [["version", "DESC"]], ...options });

export const findRevision = async (postId, version, options = {}) =>
    PostRevision.findOne({ where: { postId, version }, include: [editorInclude], ...options });

// the list leaves the bodies out: they can be large and are fetched one at a time
export const findRevisions = async ({ postId, limit, offset }) =>
    PostRevision.findAndCountAll({
        where: { postId },
        attributes: { exclude: ["content"] },
        include: [editorInclude],
        order: [["version", "DESC"]],
        limit,
        offset,
    });

// rewrite the newest revision in place (used to merge a burst of autosaves)
export const updateRevision = async (id, data, options = {}) => PostRevision.update(data, { where: { id }, ...options });

// keep only the newest `keep` revisions of a post
export const trimRevisions = async (postId, keep, options = {}) => {
    const cutoff = await PostRevision.findOne({
        where: { postId },
        order: [["version", "DESC"]],
        offset: keep,
        attributes: ["version"],
        ...options,
    });
    if (!cutoff) return 0;
    return PostRevision.destroy({ where: { postId, version: { [Op.lte]: cutoff.version } }, ...options });
};
