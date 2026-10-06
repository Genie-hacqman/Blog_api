import { Op } from "sequelize";
import { Media, User as user } from "../database/models/index.js";

// the profile photo, joined only where a response needs it (authenticate stays join-free)
const avatarInclude = { model: Media, as: "avatar", attributes: ["id", "key"] };

// find user by id
export const findUserById = async (id, { withAvatar = false, ...options } = {}) => {
    return await user.findByPk(id, { ...(withAvatar && { include: [avatarInclude] }), ...options });
};

// many users at once (the people in an inbox, the recipients of an event)
export const findUsersByIds = async (ids, { withAvatar = false } = {}) =>
    ids.length === 0 ? [] : await user.findAll({ where: { id: ids }, ...(withAvatar && { include: [avatarInclude] }) });

// active accounts that hold one of these roles, lowest id first (who gets "a story is waiting for review")
export const findActiveUsersWithRoles = async (roles, { excludeId, limit }) =>
    await user.findAll({
        where: { role: roles, status: "active", ...(excludeId && { id: { [Op.ne]: excludeId } }) },
        attributes: ["id"],
        order: [["id", "ASC"]],
        limit,
    });

// find user by username
export const findUserByUsername = async (username, { withAvatar = false } = {}) => {
    return await user.findOne({ where: { username }, ...(withAvatar && { include: [avatarInclude] }) });
};

// find user by email
export const findUserByEmail = async (email, { withAvatar = false } = {}) => {
    return await user.findOne({ where: { email }, ...(withAvatar && { include: [avatarInclude] }) });
}


export const createUser = async ({ firstName, lastName, username, email, password }) => {
    // role and status are never taken from the caller: new accounts always start as an active "user"
    return await user.create({ firstName, lastName, username, email, password });
};

// update selected columns of a user; returns the number of rows changed
export const updateUserById = async (id, data, options = {}) => {
    const [count] = await user.update(data, { where: { id }, ...options });
    return count;
};

// how many accounts hold the admin role (used to protect the last admin)
export const countAdmins = async (options = {}) => {
    return await user.count({ where: { role: "admin", status: "active" }, ...options });
};

// Bump the failed-login counter in SQL (not read-modify-write) so parallel guesses cannot
// all read the same count and slip past the lockout. Returns the new count.
export const incrementFailedLogins = async (id) => {
    await user.increment({ failedLoginCount: 1 }, { where: { id } });
    const fresh = await user.findByPk(id, { attributes: ["failedLoginCount"] });
    return fresh?.failedLoginCount ?? 0;
};

// Lock every active admin row for the rest of the transaction, so concurrent role changes
// that could each remove "the other" admin are forced to run one after the other.
export const lockActiveAdmins = async (options) => {
    return await user.findAll({
        where: { role: "admin", status: "active" },
        attributes: ["id"],
        lock: options.transaction.LOCK.UPDATE,
        transaction: options.transaction,
    });
};
