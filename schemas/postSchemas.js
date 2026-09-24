import * as z from "zod";

// validation schema for creating a new post
export const createPostSchema = z.object({
    title: z.string().trim().min(1, { message: "title is required" }),
    content: z.string().trim().min(1, { message: "content is required" }),
})

// validation schema for updating an existing post (partial update)
export const updatePostSchema = createPostSchema
    .partial()
    .refine(
        (data) => data.title !== undefined || data.content !== undefined,
        { message: "At least one of title or content must be provided" }
    )
