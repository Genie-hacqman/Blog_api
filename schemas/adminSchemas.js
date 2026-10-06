import * as z from "zod";
import { ROLES } from "../config/roles.js";
import { MAX_NOTE_LENGTH } from "../config/moderation.js";

export const suspendSchema = z.object({
    reason: z.string().trim().min(1, { message: "A reason is required" }).max(MAX_NOTE_LENGTH, { message: `reason must be at most ${MAX_NOTE_LENGTH} characters` }),
});

// the admin user list: every filter optional, anything else is ignored
export const userListQuerySchema = z.object({
    q: z.string().trim().max(60).optional(),
    role: z.enum(Object.values(ROLES)).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    verified: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
});
