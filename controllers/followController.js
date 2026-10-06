import { follow, listFollowers, listFollowing, unfollow } from "../services/followService.js";
import { parsePagination } from "../utils/pagination.js";
import { sendSuccess } from "../utils/response.js";

export const followUser = async (req, res) => sendSuccess(res, 200, await follow(req.user, req.params.username));
export const unfollowUser = async (req, res) => sendSuccess(res, 200, await unfollow(req.user, req.params.username));

export const getFollowers = async (req, res) => {
    const { people, pagination } = await listFollowers(req.params.username, parsePagination(req.query));
    return sendSuccess(res, 200, { people }, { pagination });
};

export const getFollowing = async (req, res) => {
    const { people, pagination } = await listFollowing(req.params.username, parsePagination(req.query));
    return sendSuccess(res, 200, { people }, { pagination });
};
