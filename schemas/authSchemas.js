import * as z from "zod";
import { PASSWORD_MAX_LENGTH } from "../config/auth.js";
import { ROLES } from "../config/roles.js";
import { newPasswordSchema } from "./userSchemas.js";

// the emailed token is opaque; only bound its size
const tokenSchema = z.string({ error: "token is required" }).min(1, { message: "token is required" }).max(200);

export const verifyEmailSchema = z.object({ token: tokenSchema });

export const forgotPasswordSchema = z.object({
    email: z.email().trim().toLowerCase().max(255),
});

export const resetPasswordSchema = z.object({
    token: tokenSchema,
    password: newPasswordSchema,
});

export const changePasswordSchema = z.object({
    currentPassword: z.string({ error: "current password is required" }).min(1, { message: "current password is required" }).max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
});

export const setRoleSchema = z.object({
    role: z.enum(Object.values(ROLES), { error: `role must be one of: ${Object.values(ROLES).join(", ")}` }),
});
