import * as z from "zod";
import { MAX_READ_SECONDS } from "../config/analytics.js";

// Only these keys are read. The browser says what it saw; who it is comes from the connection, never from the body.
export const viewSchema = z.object({
    postId: z.number().int().positive(),
    referrer: z.string().max(2000).nullable().optional(),
});

export const readingSchema = z.object({
    postId: z.number().int().positive(),
    seconds: z.number().min(0).max(MAX_READ_SECONDS),
    depth: z.number().min(0).max(100),
});
