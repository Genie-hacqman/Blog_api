import { Op } from "sequelize";
import { RefreshToken } from "../database/models/index.js";

export const createRefreshToken = async (data, options = {}) => RefreshToken.create(data, options);

export const findRefreshTokenByHash = async (tokenHash) => RefreshToken.findOne({ where: { tokenHash } });

// Retire a token as part of rotation. The `revokedAt IS NULL` condition makes this atomic:
// when two requests rotate the same token at once, only one gets count 1.
export const markRotated = async (id, replacedById, options = {}) => {
    const [count] = await RefreshToken.update(
        { revokedAt: new Date(), replacedById },
        { where: { id, revokedAt: null }, ...options },
    );
    return count;
};

// end a whole session (every token in the family that is still live)
export const revokeFamily = async (familyId, options = {}) => {
    const [count] = await RefreshToken.update({ revokedAt: new Date() }, { where: { familyId, revokedAt: null }, ...options });
    return count;
};

// end all of a user's sessions, optionally keeping one
export const revokeAllForUser = async (userId, { exceptFamilyId, ...options } = {}) => {
    const where = { userId, revokedAt: null };
    if (exceptFamilyId) {
        where.familyId = { [Op.ne]: exceptFamilyId };
    }
    const [count] = await RefreshToken.update({ revokedAt: new Date() }, { where, ...options });
    return count;
};

// a session is alive while its family has a token that is neither revoked nor expired
export const isFamilyActive = async (familyId) => {
    const count = await RefreshToken.count({
        where: { familyId, revokedAt: null, expiresAt: { [Op.gt]: new Date() } },
    });
    return count > 0;
};
