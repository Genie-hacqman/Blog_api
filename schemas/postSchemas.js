import * as z from "zod";
import { postTagsSchema } from "./taxonomySchemas.js";
import {
    MAX_CONTENT_LENGTH,
    MAX_COVER_ALT_LENGTH,
    MAX_EXCERPT_LENGTH,
    MAX_REJECTION_REASON_LENGTH,
    MAX_SLUG_LENGTH,
    MAX_TITLE_LENGTH,
    POST_STATUSES,
    SLUG_PATTERN,
} from "../config/posts.js";

// limits keep input inside what the columns can hold and well under the JSON body limit set in app.js
export { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH };

const title = z.string().trim().min(1, { message: "title is required" }).max(MAX_TITLE_LENGTH, { message: `title must be at most ${MAX_TITLE_LENGTH} characters` });
// the body arrives as HTML from the editor (plain text is accepted and wrapped); it is sanitized by the service
const content = z.string().trim().min(1, { message: "content is required" }).max(MAX_CONTENT_LENGTH, { message: `content must be at most ${MAX_CONTENT_LENGTH} characters` });
// the cover image's description; empty means none
const coverAlt = z
    .string()
    .trim()
    .max(MAX_COVER_ALT_LENGTH, { message: `coverAlt must be at most ${MAX_COVER_ALT_LENGTH} characters` })
    .transform((value) => (value === "" ? null : value))
    .nullable();
const coverMediaId = z.number().int().positive().nullable();

// an empty excerpt means "generate one from the content"
const excerpt = z
    .string()
    .trim()
    .max(MAX_EXCERPT_LENGTH, { message: `excerpt must be at most ${MAX_EXCERPT_LENGTH} characters` })
    .transform((value) => (value === "" ? null : value))
    .nullable();
const slug = z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { message: "slug cannot be empty" })
    .max(MAX_SLUG_LENGTH, { message: `slug must be at most ${MAX_SLUG_LENGTH} characters` })
    .regex(SLUG_PATTERN, { message: "slug can only contain lowercase letters, numbers and single hyphens" });

// Creating always makes a draft. `published` is accepted only for people who may publish without
// review (checked in the service); anything else about the lifecycle goes through the status endpoint.
// Unknown keys (userId, publishedAt, role...) are dropped by the parse, never stored.
export const createPostSchema = z.object({
    title,
    content,
    excerpt: excerpt.optional(),
    slug: slug.optional(),
    status: z.enum(["draft", "published"]).optional(),
    // one section (or none) and up to five topics; the tag names are checked in detail by the service
    categoryId: z.number().int().positive().nullable().optional(),
    tags: postTagsSchema.optional(),
    coverMediaId: coverMediaId.optional(),
    coverAlt: coverAlt.optional(),
});

// content edits only: no status, no author, no dates
export const updatePostSchema = z
    .object({
        title: title.optional(),
        content: content.optional(),
        excerpt: excerpt.optional(),
        slug: slug.optional(),
        categoryId: z.number().int().positive().nullable().optional(),
        tags: postTagsSchema.optional(),
        coverMediaId: coverMediaId.optional(),
        coverAlt: coverAlt.optional(),
        // the version the writer's screen started from (see EDIT_CONFLICT); it is not a change by itself
        expectedUpdatedAt: z.iso.datetime({ offset: true, error: "expectedUpdatedAt must be an ISO 8601 date-time" }).transform((value) => new Date(value)).optional(),
    })
    .refine((data) => Object.entries(data).some(([key, value]) => key !== "expectedUpdatedAt" && value !== undefined), {
        message: "At least one of title, content, excerpt, slug, categoryId, tags, coverMediaId or coverAlt must be provided",
    });

export const changeStatusSchema = z.object({
    to: z.enum(POST_STATUSES, { error: `status must be one of: ${POST_STATUSES.join(", ")}` }),
    publishAt: z.iso.datetime({ offset: true, error: "publishAt must be an ISO 8601 date-time" }).transform((value) => new Date(value)).optional(),
    reason: z.string().trim().min(1).max(MAX_REJECTION_REASON_LENGTH, { message: `reason must be at most ${MAX_REJECTION_REASON_LENGTH} characters` }).optional(),
});

export const listMineQuerySchema = z.object({ status: z.enum(POST_STATUSES).optional() });

export const compareQuerySchema = z.object({
    from: z.coerce.number().int().positive(),
    to: z.union([z.literal("current"), z.coerce.number().int().positive()]),
});
