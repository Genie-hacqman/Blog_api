import * as z from "zod";
import {
    CATEGORY_DESCRIPTION_MAX,
    CATEGORY_NAME_MAX,
    CATEGORY_NAME_MIN,
    MAX_TAGS_PER_POST,
    SEARCH_QUERY_MAX,
    TAG_LIST_MAX,
} from "../config/taxonomy.js";

// slugs in addresses and filters: lowercase letters, digits, hyphens
export const slugParam = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: "invalid slug" }).max(80);

const categoryName = z
    .string({ error: "name is required" })
    .trim()
    .min(CATEGORY_NAME_MIN, { message: `name must be at least ${CATEGORY_NAME_MIN} characters` })
    .max(CATEGORY_NAME_MAX, { message: `name must be at most ${CATEGORY_NAME_MAX} characters` });

// an empty description clears it
const description = z
    .string()
    .trim()
    .max(CATEGORY_DESCRIPTION_MAX, { message: `description must be at most ${CATEGORY_DESCRIPTION_MAX} characters` })
    .transform((value) => (value === "" ? null : value))
    .nullable();

// strict: a body with any other key (slug, id, postCount...) is a 400, not silently ignored
export const createCategorySchema = z.object({ name: categoryName, description: description.optional() }).strict();

export const updateCategorySchema = z
    .object({ name: categoryName.optional(), description: description.optional() })
    .strict()
    .refine((data) => data.name !== undefined || data.description !== undefined, { message: "Provide name and/or description" });

// the rules about which characters a tag may contain are applied by prepareTags (utils/taxonomy.js); this only bounds the size
export const renameTagSchema = z.object({ name: z.string({ error: "name is required" }).max(60) }).strict();

// the tag names sent with a post: bounded before any work is done on them
export const postTagsSchema = z
    .array(z.string().max(60, { message: "tag is too long" }), { error: "tags must be a list of names" })
    .max(MAX_TAGS_PER_POST, { message: `a post can have at most ${MAX_TAGS_PER_POST} tags` });

export const postListQuerySchema = z.object({ category: slugParam.optional(), tag: slugParam.optional() });

export const tagListQuerySchema = z.object({
    q: z.string().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(TAG_LIST_MAX).optional(),
});

export const searchQuerySchema = z.object({
    q: z.string({ error: "q is required" }).max(SEARCH_QUERY_MAX * 2, { message: `q must be at most ${SEARCH_QUERY_MAX} characters` }),
    category: slugParam.optional(),
    tag: slugParam.optional(),
    sort: z.enum(["relevance", "newest"]).optional(),
});
