import { deleteAccount } from "../services/accountService.js";
import { getProfilePosts, getPublicProfile, removeAvatar, setAvatar, updateProfile } from "../services/profileService.js";
import { parsePagination } from "../utils/pagination.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

export const getProfile = async (req, res) => {
    const user = await getPublicProfile(req.params.username, req.user ?? null);
    return sendSuccess(res, 200, { user });
};

export const getPostsOfProfile = async (req, res) => {
    const { posts, pagination } = await getProfilePosts(req.params.username, parsePagination(req.query));
    return sendSuccess(res, 200, { posts }, { pagination });
};

export const updateMe = async (req, res) => {
    const user = await updateProfile(req.user.id, req.body);
    return sendSuccess(res, 200, { user });
};

export const putAvatar = async (req, res) => {
    const user = await setAvatar(req.user.id, req.file);
    return sendSuccess(res, 200, { user });
};

export const deleteAvatar = async (req, res) => {
    const user = await removeAvatar(req.user.id);
    return sendSuccess(res, 200, { user });
};

export const deleteMe = async (req, res) => {
    await deleteAccount(req.user.id, req.body.password, requestContext(req));
    // the refresh cookie belongs to a session that no longer exists
    res.clearCookie("refresh_token", { path: "/api/auth" });
    return sendSuccess(res, 200);
};
