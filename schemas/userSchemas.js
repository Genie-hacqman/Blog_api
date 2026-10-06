import  *  as z from "zod";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../config/auth.js";
import { RESERVED_USERNAMES, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "../config/profile.js";

// Passwords are never trimmed or altered: what the user typed at registration is exactly
// what they must type at login. The upper bound keeps hashing cost bounded.
export const newPasswordSchema = z
    .string({ error: "password is required" })
    .min(PASSWORD_MIN_LENGTH, { message: `password must be at least ${PASSWORD_MIN_LENGTH} characters` })
    .max(PASSWORD_MAX_LENGTH, { message: `password must be at most ${PASSWORD_MAX_LENGTH} characters` });

// usernames are part of public URLs (/u/<username>), so they are URL-safe and cannot impersonate routes or staff
const usernameSchema = z
    .string()
    .trim()
    .min(USERNAME_MIN_LENGTH, { message: `username must be at least ${USERNAME_MIN_LENGTH} characters` })
    .max(USERNAME_MAX_LENGTH, { message: `username must be at most ${USERNAME_MAX_LENGTH} characters` })
    .regex(USERNAME_PATTERN, { message: "username can only contain letters, numbers and underscores" })
    .refine((value) => !RESERVED_USERNAMES.has(value.toLowerCase()), { message: "that username is not available" });

// emails are case-insensitive; store and compare them lowercased
const emailSchema = z.email().trim().toLowerCase().max(255);

// validation schema for creating a new user
// (max lengths match the VARCHAR(255) columns so oversized input is a 400, not a database error)

export const createUserSchema = z.object({
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    userName: usernameSchema,
    email: emailSchema,
    password: newPasswordSchema,

})

// validation schema for login: any non-empty password is checked against the hash, so a
// wrong short password is a 401 like any other wrong password, not a 400
export const loginUserSchema = z.object({
    email: emailSchema,
    password: z.string({ error: "password is required" }).min(1, { message: "password is required" }).max(PASSWORD_MAX_LENGTH),
})
