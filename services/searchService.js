import { getSearchProvider } from "../providers/search/index.js";
import { findPublishedByIds } from "../repositories/postRepository.js";
import { findCategoryBySlug } from "../repositories/categoryRepository.js";
import { findTagBySlug } from "../repositories/tagRepository.js";
import { attachPostData } from "./engagementService.js";
import { toPreview } from "./postService.js";
import { extractTerms, normalizeQuery, tagSlugsFor, usernameCandidates } from "../utils/searchQuery.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";

// Search published posts. The engine decides which posts match and in what order; this layer
// validates the question, loads the posts, and has the last word on what may be shown.
export const searchPosts = async ({ q, category, tag, sort = "relevance", page, limit }) => {
    const query = normalizeQuery(q);
    const terms = extractTerms(query);
    if (terms.length === 0) {
        throw new ValidationError("Search for at least one word of two or more letters or digits");
    }

    // a filter that names something that does not exist is a "not found", not an empty result
    let categoryId;
    let tagId;
    if (category) {
        const found = await findCategoryBySlug(category);
        if (!found) throw new NotFoundError("Category not found");
        categoryId = found.id;
    }
    if (tag) {
        const found = await findTagBySlug(tag);
        if (!found) throw new NotFoundError("Tag not found");
        tagId = found.id;
    }

    const { ids, total } = await getSearchProvider().search({
        query,
        terms,
        tagSlugs: tagSlugsFor(query, terms),
        usernames: usernameCandidates(query),
        categoryId,
        tagId,
        sort,
        limit,
        offset: (page - 1) * limit,
    });

    // Whatever the engine returned, only posts that are published right now are shown, in the engine's order.
    const posts = await attachPostData(await findPublishedByIds(ids));

    return {
        posts: posts.map(toPreview),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        query,
    };
};
