import { fn, literal, Op } from "sequelize";
import { Comment, Post, User } from "../database/models/index.js";
import { escapeLike } from "../utils/searchQuery.js";

// counts per value of one column, in one grouped query: { value: count }
const countBy = async (model, column, where = {}) => {
    const rows = await model.findAll({ attributes: [column, [fn("COUNT", literal("*")), "n"]], where, group: [column], raw: true });
    return Object.fromEntries(rows.map((row) => [row[column], Number(row.n)]));
};

export const countUsersByStatus = () => countBy(User, "status");
export const countUsersByRole = () => countBy(User, "role", { status: { [Op.ne]: "deleted" } });
export const countPostsByStatus = () => countBy(Post, "status");

export const countUsersCreatedSince = (since) => User.count({ where: { createdAt: { [Op.gte]: since }, status: { [Op.ne]: "deleted" } } });
export const countPostsPublishedSince = (since) => Post.count({ where: { status: "published", publishedAt: { [Op.gte]: since } } });
export const countLiveComments = () => Comment.count({ where: { deletedAt: null } });
export const countCommentsSince = (since) => Comment.count({ where: { deletedAt: null, createdAt: { [Op.gte]: since } } });

// People for the admin list. `q` matches the start of a username or an email address (or an exact id).
export const searchUsers = async ({ q, role, status, verified, limit, offset }) => {
    const where = {};
    if (q) {
        const prefix = `${escapeLike(q)}%`;
        where[Op.or] = [{ username: { [Op.like]: prefix } }, { email: { [Op.like]: prefix } }, ...(/^\d+$/.test(q) ? [{ id: Number(q) }] : [])];
    }
    if (role) where.role = role;
    if (status) where.status = status;
    if (verified === true) where.emailVerifiedAt = { [Op.ne]: null };
    if (verified === false) where.emailVerifiedAt = null;
    return User.findAndCountAll({
        where,
        attributes: { exclude: ["password"] },
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit,
        offset,
    });
};

export const countPostsBy = (userId) => Post.count({ where: { userId } });
export const countCommentsBy = (userId) => Comment.count({ where: { userId, deletedAt: null } });
