import { countPublishedByUser } from "../repositories/postRepository.js";
import { findUserById, findUserByUsername, updateUserById } from "../repositories/userRepository.js";
import { getAllPosts } from "./postService.js";
import { followStats } from "./followService.js";
import { discardMedia, storeImage } from "./mediaService.js";
import { sanitizeUser } from "./userService.js";
import { avatarUrlOf } from "../utils/author.js";
import { NotFoundError } from "../utils/AppError.js";

// A profile is public, so it is built field by field: no email, no real name, no role.
const toPublicProfile = (user, postCount) => ({
    username: user.username,
    bio: user.bio ?? null,
    avatarUrl: avatarUrlOf(user),
    socialLinks: user.socialLinks ?? null,
    joinedAt: user.createdAt,
    postCount,
});

// only active accounts have a public profile; deleted and suspended ones look like they do not exist
const findPublicUser = async (username) => {
    const user = await findUserByUsername(username, { withAvatar: true });
    if (!user || user.status !== "active") {
        throw new NotFoundError("User not found");
    }
    return user;
};

export const getPublicProfile = async (username, viewer = null) => {
    const user = await findPublicUser(username);
    return { ...toPublicProfile(user, await countPublishedByUser(user.id)), ...(await followStats(user, viewer)) };
};

export const getProfilePosts = async (username, { page, limit }) => {
    const user = await findPublicUser(username);
    return getAllPosts({ page, limit, userId: user.id });
};

export const updateProfile = async (userId, changes) => {
    // the schema only lets bio and socialLinks through
    const data = {};
    if (changes.bio !== undefined) data.bio = changes.bio;
    if (changes.socialLinks !== undefined) data.socialLinks = changes.socialLinks;
    await updateUserById(userId, data);
    return sanitizeUser(await findUserById(userId, { withAvatar: true }));
};

// Upload and attach in one step so a failed attach never leaves an unused file behind;
// the previous photo is retired only after the new one is in place.
export const setAvatar = async (userId, file) => {
    const previous = (await findUserById(userId, { withAvatar: true })).avatar;
    const media = await storeImage(userId, file, "avatar");
    try {
        await updateUserById(userId, { avatarMediaId: media.id });
    } catch (error) {
        await discardMedia(media);
        throw error;
    }
    if (previous) {
        await discardMedia(previous);
    }
    return sanitizeUser(await findUserById(userId, { withAvatar: true }));
};

export const removeAvatar = async (userId) => {
    const user = await findUserById(userId, { withAvatar: true });
    if (user.avatar) {
        await updateUserById(userId, { avatarMediaId: null });
        await discardMedia(user.avatar);
    }
    return sanitizeUser(await findUserById(userId, { withAvatar: true }));
};
