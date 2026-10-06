import * as z from "zod";
import { MAX_COMMENT_LENGTH } from "../config/engagement.js";

const body = z
    .string()
    .trim()
    .min(1, { message: "comment is required" })
    .max(MAX_COMMENT_LENGTH, { message: `comment must be at most ${MAX_COMMENT_LENGTH} characters` });

// Only these keys are read: the author, the post and the dates always come from the server.
export const createCommentSchema = z.object({
    body,
    parentId: z.number().int().positive().nullable().optional(),
});

export const updateCommentSchema = z.object({ body });
