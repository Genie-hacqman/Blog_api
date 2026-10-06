import { createComment, deleteComment, editComment, listComments, listReplies } from "../services/commentService.js";
import { requireValidId } from "../utils/ids.js";
import { parsePagination } from "../utils/pagination.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

// anonymous visitors are null
const viewer = (req) => req.user ?? null;

export const getComments = async (req, res) => {
    const { comments, pagination } = await listComments(requireValidId(req.params.id), viewer(req), parsePagination(req.query));
    return sendSuccess(res, 200, { comments }, { pagination });
};

export const postComment = async (req, res) => {
    const comment = await createComment(req.user, requireValidId(req.params.id), req.body);
    return sendSuccess(res, 201, { comment });
};

export const getReplies = async (req, res) => {
    const { comments, pagination } = await listReplies(requireValidId(req.params.id, "Comment"), viewer(req), parsePagination(req.query));
    return sendSuccess(res, 200, { comments }, { pagination });
};

export const patchComment = async (req, res) => {
    const comment = await editComment(requireValidId(req.params.id, "Comment"), req.user, req.body);
    return sendSuccess(res, 200, { comment });
};

export const removeComment = async (req, res) => {
    // a moderator or the story's author may leave a short note for the comment's author (optional)
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, 500) : null;
    await deleteComment(requireValidId(req.params.id, "Comment"), req.user, requestContext(req), note);
    return sendSuccess(res, 200);
};
