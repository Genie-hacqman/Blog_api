import { deleteTag, getTag, listTags, renameTag } from "../services/tagService.js";
import { tagListQuerySchema } from "../schemas/taxonomySchemas.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

const requireId = (id) => {
    if (!/^\d+$/.test(String(id))) throw new NotFoundError("Tag not found");
    return Number(id);
};

export const list = async (req, res) => {
    const parsed = tagListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
    const tags = await listTags({ prefix: parsed.data.q, limit: parsed.data.limit ?? 20 });
    return sendSuccess(res, 200, { tags });
};

export const show = async (req, res) => sendSuccess(res, 200, { tag: await getTag(req.params.slug) });

export const rename = async (req, res) =>
    sendSuccess(res, 200, { tag: await renameTag(req.user, requireId(req.params.id), req.body.name, requestContext(req)) });

export const remove = async (req, res) => {
    await deleteTag(req.user, requireId(req.params.id), requestContext(req));
    return sendSuccess(res, 200);
};
