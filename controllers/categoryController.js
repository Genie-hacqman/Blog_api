import {
    createNewCategory,
    deleteExistingCategory,
    getCategories,
    getCategory,
    updateExistingCategory,
} from "../services/categoryService.js";
import { NotFoundError } from "../utils/AppError.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

const requireId = (id) => {
    if (!/^\d+$/.test(String(id))) throw new NotFoundError("Category not found");
    return Number(id);
};

export const list = async (req, res) => sendSuccess(res, 200, { categories: await getCategories() });

export const show = async (req, res) => sendSuccess(res, 200, { category: await getCategory(req.params.slug) });

export const create = async (req, res) =>
    sendSuccess(res, 201, { category: await createNewCategory(req.user, req.body, requestContext(req)) });

export const update = async (req, res) =>
    sendSuccess(res, 200, { category: await updateExistingCategory(req.user, requireId(req.params.id), req.body, requestContext(req)) });

export const remove = async (req, res) => {
    await deleteExistingCategory(req.user, requireId(req.params.id), requestContext(req));
    return sendSuccess(res, 200);
};
