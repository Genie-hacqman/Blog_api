import { bookmarkPost, likePost, unbookmarkPost, unlikePost } from "../services/engagementService.js";
import { getFeed, listBookmarks } from "../services/feedService.js";
import { requireValidId } from "../utils/ids.js";
import { parsePagination } from "../utils/pagination.js";
import { sendSuccess } from "../utils/response.js";

export const like = async (req, res) => sendSuccess(res, 200, await likePost(requireValidId(req.params.id), req.user));
export const unlike = async (req, res) => sendSuccess(res, 200, await unlikePost(requireValidId(req.params.id), req.user));
export const bookmark = async (req, res) => sendSuccess(res, 200, await bookmarkPost(requireValidId(req.params.id), req.user));
export const unbookmark = async (req, res) => sendSuccess(res, 200, await unbookmarkPost(requireValidId(req.params.id), req.user));

export const getBookmarks = async (req, res) => {
    const { posts, pagination } = await listBookmarks(req.user, parsePagination(req.query));
    return sendSuccess(res, 200, { posts }, { pagination });
};

export const getFeedPosts = async (req, res) => {
    const { posts, pagination } = await getFeed(req.user, parsePagination(req.query));
    return sendSuccess(res, 200, { posts }, { pagination });
};
