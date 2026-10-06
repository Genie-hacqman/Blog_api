import {
    createPost as createPostService,
    deletePost as deletePostService,
    getAllPosts as getAllPostsService,
    getPostById as getPostByIdService,
    getPostBySlug as getPostBySlugService,
    listMyPosts as listMyPostsService,
    listReviewQueue as listReviewQueueService,
    updatePost as updatePostService,
} from "../services/postService.js";
import { changePostStatus } from "../services/postStatusService.js";
import { compareRevisions, getRevision, listRevisions, restoreRevision } from "../services/postRevisionService.js";
import { compareQuerySchema, listMineQuerySchema } from "../schemas/postSchemas.js";
import { postListQuerySchema } from "../schemas/taxonomySchemas.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { parsePagination } from "../utils/pagination.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

// a route param must look like a real id before we hit the DB; anything else is simply "not found"
const requireValidId = (id, what = "Post") => {
    if (!/^\d+$/.test(String(id))) {
        throw new NotFoundError(`${what} not found`);
    }
    return Number(id);
};

// anonymous visitors are null
const viewer = (req) => req.user ?? null;

const parseQuery = (schema, query) => {
    const result = schema.safeParse(query);
    if (!result.success) {
        throw new ValidationError(result.error.issues[0].message);
    }
    return result.data;
};

export const createPost = async (req, res) => {
    const post = await createPostService(req.user, req.body, requestContext(req));
    return sendSuccess(res, 201, { post });
};

export const getAllPosts = async (req, res) => {
    const { category, tag } = parseQuery(postListQuerySchema, req.query);
    const { posts, pagination } = await getAllPostsService({ ...parsePagination(req.query), category, tag });
    return sendSuccess(res, 200, { posts }, { pagination });
};

export const getMyPosts = async (req, res) => {
    const { status } = parseQuery(listMineQuerySchema, req.query);
    const { posts, pagination } = await listMyPostsService(req.user, { status, ...parsePagination(req.query) });
    return sendSuccess(res, 200, { posts }, { pagination });
};

export const getReviewQueue = async (req, res) => {
    const { posts, pagination } = await listReviewQueueService(parsePagination(req.query));
    return sendSuccess(res, 200, { posts }, { pagination });
};

export const getPostById = async (req, res) => {
    const post = await getPostByIdService(requireValidId(req.params.id), viewer(req));
    return sendSuccess(res, 200, { post });
};

export const getPostBySlug = async (req, res) => {
    const post = await getPostBySlugService(req.params.slug, viewer(req));
    return sendSuccess(res, 200, { post });
};

export const updatePost = async (req, res) => {
    const post = await updatePostService(requireValidId(req.params.id), req.user, req.body);
    return sendSuccess(res, 200, { post });
};

export const changeStatus = async (req, res) => {
    const post = await changePostStatus(requireValidId(req.params.id), req.user, req.body, requestContext(req));
    return sendSuccess(res, 200, { post });
};

export const deletePost = async (req, res) => {
    await deletePostService(requireValidId(req.params.id), req.user);
    return sendSuccess(res, 200);
};

export const getRevisions = async (req, res) => {
    const { revisions, pagination } = await listRevisions(requireValidId(req.params.id), req.user, parsePagination(req.query));
    return sendSuccess(res, 200, { revisions }, { pagination });
};

export const getRevisionByVersion = async (req, res) => {
    const revision = await getRevision(requireValidId(req.params.id), requireValidId(req.params.version, "Revision"), req.user);
    return sendSuccess(res, 200, { revision });
};

export const compare = async (req, res) => {
    const { from, to } = parseQuery(compareQuerySchema, req.query);
    const comparison = await compareRevisions(requireValidId(req.params.id), req.user, from, to);
    return sendSuccess(res, 200, { comparison });
};

export const restore = async (req, res) => {
    const id = requireValidId(req.params.id);
    await restoreRevision(id, requireValidId(req.params.version, "Revision"), req.user, requestContext(req));
    const post = await getPostByIdService(id, req.user);
    return sendSuccess(res, 200, { post });
};
