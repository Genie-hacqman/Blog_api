import { Op } from "sequelize";
import { Follow, Media, User } from "../database/models/index.js";

const personInclude = (as) => ({
    model: User,
    as,
    attributes: ["id", "username", "status"],
    where: { status: "active" },
    required: true,
    include: [{ model: Media, as: "avatar", attributes: ["id", "key"] }],
});

export const addFollow = async (followerId, followingId) => {
    await Follow.bulkCreate([{ followerId, followingId }], { ignoreDuplicates: true });
};

export const removeFollow = async (followerId, followingId) => Follow.destroy({ where: { followerId, followingId } });

export const isFollowing = async (followerId, followingId) => Boolean(await Follow.findOne({ where: { followerId, followingId }, attributes: ["followerId"] }));

export const countFollowers = async (userId) => Follow.count({ where: { followingId: userId } });
export const countFollowing = async (userId) => Follow.count({ where: { followerId: userId } });

// the people who follow userId, most recent first
export const findFollowersPage = async ({ userId, limit, offset }) => {
    const { rows, count } = await Follow.findAndCountAll({
        where: { followingId: userId },
        include: [personInclude("follower")],
        order: [["createdAt", "DESC"], ["followerId", "DESC"]],
        limit,
        offset,
    });
    return { people: rows.map((row) => row.follower), count };
};

// the people userId follows, most recent first
export const findFollowingPage = async ({ userId, limit, offset }) => {
    const { rows, count } = await Follow.findAndCountAll({
        where: { followerId: userId },
        include: [personInclude("following")],
        order: [["createdAt", "DESC"], ["followingId", "DESC"]],
        limit,
        offset,
    });
    return { people: rows.map((row) => row.following), count };
};

// account deletion: every follow to or from the person
export const removeFollowsOfUser = async (userId, options = {}) =>
    Follow.destroy({ where: { [Op.or]: [{ followerId: userId }, { followingId: userId }] }, ...options });
