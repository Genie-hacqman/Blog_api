import { Op } from "sequelize";
import { UserToken } from "../database/models/index.js";

export const createUserToken = async (data, options = {}) => UserToken.create(data, options);

// an unused, unexpired token for this purpose, or null
export const findUsableToken = async (purpose, tokenHash) =>
    UserToken.findOne({
        where: { purpose, tokenHash, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
    });

// Single-use guard: only the first caller flips usedAt and gets count 1.
export const markTokenUsed = async (id, options = {}) => {
    const [count] = await UserToken.update({ usedAt: new Date() }, { where: { id, usedAt: null }, ...options });
    return count;
};

// a newly issued token replaces any earlier unused one of the same kind
export const invalidateUnusedTokens = async (userId, purpose, options = {}) => {
    const [count] = await UserToken.update({ usedAt: new Date() }, { where: { userId, purpose, usedAt: null }, ...options });
    return count;
};

export const countTokensSince = async (userId, purpose, since) =>
    UserToken.count({ where: { userId, purpose, createdAt: { [Op.gte]: since } } });

// remove every outstanding emailed token (used when an account is deleted)
export const deleteTokensForUser = async (userId, options = {}) => UserToken.destroy({ where: { userId }, ...options });
