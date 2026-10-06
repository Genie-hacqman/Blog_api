import { searchPosts } from "../services/searchService.js";
import { searchQuerySchema } from "../schemas/taxonomySchemas.js";
import { SEARCH_MAX_PAGE } from "../config/taxonomy.js";
import { ValidationError } from "../utils/AppError.js";
import { parsePagination } from "../utils/pagination.js";
import { sendSuccess } from "../utils/response.js";

export const search = async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);

    const { posts, pagination, query } = await searchPosts({
        ...parsed.data,
        ...parsePagination(req.query, { maxPage: SEARCH_MAX_PAGE }),
    });
    return sendSuccess(res, 200, { posts }, { pagination, query });
};
