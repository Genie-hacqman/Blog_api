import * as z from "zod";
import { TYPE_NAMES } from "../config/notifications.js";

// either some ids (at most 100) or { all: true }, never both and never neither
export const markReadSchema = z
    .object({
        ids: z.array(z.number().int().positive()).min(1).max(100).optional(),
        all: z.literal(true).optional(),
    })
    .refine((data) => (data.ids !== undefined) !== (data.all !== undefined), { message: "Send either ids or all: true" });

export const preferencesSchema = z.object({
    preferences: z
        .array(
            z.object({
                type: z.enum(TYPE_NAMES, { error: `type must be one of: ${TYPE_NAMES.join(", ")}` }),
                inApp: z.boolean(),
                email: z.boolean(),
            }),
        )
        .min(1)
        .max(TYPE_NAMES.length)
        .refine((items) => new Set(items.map((item) => item.type)).size === items.length, { message: "Each type can appear once" }),
});
