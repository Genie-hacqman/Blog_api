import * as z from "zod";
import { MAX_DETAILS_LENGTH, MAX_NOTE_LENGTH, REASON_NAMES, TARGET_TYPES } from "../config/moderation.js";

const details = z
    .string()
    .trim()
    .max(MAX_DETAILS_LENGTH, { message: `details must be at most ${MAX_DETAILS_LENGTH} characters` })
    .transform((value) => (value === "" ? null : value))
    .nullable();

// a story or a comment is named by its id, a person by their username
export const createReportSchema = z
    .object({
        targetType: z.enum(TARGET_TYPES, { error: `targetType must be one of: ${TARGET_TYPES.join(", ")}` }),
        targetId: z.union([z.number().int().positive(), z.string().trim().min(1).max(60)]),
        reason: z.enum(REASON_NAMES, { error: `reason must be one of: ${REASON_NAMES.join(", ")}` }),
        details: details.optional(),
    })
    .superRefine((data, ctx) => {
        const wantsName = data.targetType === "user";
        if (wantsName !== (typeof data.targetId === "string")) {
            ctx.addIssue({ code: "custom", path: ["targetId"], message: wantsName ? "targetId must be a username" : "targetId must be an id" });
        }
    });

export const resolveReportSchema = z.object({
    action: z.enum(["dismiss", "remove", "unpublish", "suspend"], { error: "action must be one of: dismiss, remove, unpublish, suspend" }),
    note: z.string().trim().max(MAX_NOTE_LENGTH, { message: `note must be at most ${MAX_NOTE_LENGTH} characters` }).optional(),
});
