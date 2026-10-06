import { MAX_FOLLOWING } from "../config/engagement.js";
import {
    addFollow,
    countFollowers,
    countFollowing,
    findFollowersPage,
    findFollowingPage,
    isFollowing,
    removeFollow,
} from "../repositories/followRepository.js";
import { findUserByUsername } from "../repositories/userRepository.js";
import { publishEvent } from "./notificationService.js";
import { avatarUrlOf } from "../utils/author.js";
import { AppError, NotFoundError } from "../utils/AppError.js";

// only active accounts can be followed or listed; deleted and suspended ones look like they do not exist
const activeUserOrNotFound = async (username) => {
    const user = await findUserByUsername(username, { withAvatar: true });
    if (!user || user.status !== "active") throw new NotFoundError("User not found");
    return user;
};

// a person in a list: name and photo, nothing else
const toPerson = (user) => ({ username: user.username, avatarUrl: avatarUrlOf(user) });

// Both are idempotent: following someone you already follow, or unfollowing someone you do not, succeeds.
export const follow = async (follower, username) => {
    const target = await activeUserOrNotFound(username);
    if (target.id === follower.id) throw new AppError(400, "CANNOT_FOLLOW_SELF", "You cannot follow yourself");

    const already = await isFollowing(follower.id, target.id);
    if (!already && (await countFollowing(follower.id)) >= MAX_FOLLOWING) {
        throw new AppError(409, "FOLLOW_LIMIT", `You can follow at most ${MAX_FOLLOWING} people`);
    }
    await addFollow(follower.id, target.id);
    // only a new follow is news (and the notification's unique key means follow, unfollow, follow tells them once)
    if (!already) void publishEvent({ event: "follow_created", followerId: follower.id, followingId: target.id });
    return { following: true, followerCount: await countFollowers(target.id) };
};

export const unfollow = async (follower, username) => {
    const target = await activeUserOrNotFound(username);
    await removeFollow(follower.id, target.id);
    return { following: false, followerCount: await countFollowers(target.id) };
};

const pagination = (page, limit, count) => ({ page, limit, total: count, totalPages: Math.ceil(count / limit) });

export const listFollowers = async (username, { page, limit }) => {
    const user = await activeUserOrNotFound(username);
    const { people, count } = await findFollowersPage({ userId: user.id, limit, offset: (page - 1) * limit });
    return { people: people.map(toPerson), pagination: pagination(page, limit, count) };
};

export const listFollowing = async (username, { page, limit }) => {
    const user = await activeUserOrNotFound(username);
    const { people, count } = await findFollowingPage({ userId: user.id, limit, offset: (page - 1) * limit });
    return { people: people.map(toPerson), pagination: pagination(page, limit, count) };
};

// what a profile page shows about following
export const followStats = async (user, viewer) => ({
    followerCount: await countFollowers(user.id),
    followingCount: await countFollowing(user.id),
    ...(viewer && viewer.id !== user.id && { viewer: { following: await isFollowing(viewer.id, user.id) } }),
});
