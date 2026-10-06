import * as z from "zod";
import { BIO_MAX_LENGTH, SOCIAL_LINK_HOSTS } from "../config/profile.js";
import { PASSWORD_MAX_LENGTH } from "../config/auth.js";

// control characters (other than newline) have no business in a bio
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

// An https link whose host matches the platform it is filed under. This keeps `javascript:` and
// `data:` URLs, plain http, credentials-in-URL tricks and "github" links that go elsewhere out.
const socialLink = (platform) =>
    z
        .string()
        .trim()
        .max(200, { message: "link must be at most 200 characters" })
        .superRefine((value, ctx) => {
            if (value === "") return; // an empty value clears the link
            let url;
            try {
                url = new URL(value);
            } catch {
                ctx.addIssue({ code: "custom", message: `${platform} must be a full https:// link` });
                return;
            }
            const host = url.hostname.toLowerCase();
            if (url.protocol !== "https:" || url.username || url.password) {
                ctx.addIssue({ code: "custom", message: `${platform} must be a plain https:// link` });
                return;
            }
            if (!host.includes(".") || IPV4.test(host) || host.startsWith("[")) {
                ctx.addIssue({ code: "custom", message: `${platform} must link to a public website` });
                return;
            }
            const allowed = SOCIAL_LINK_HOSTS[platform];
            if (allowed && !allowed.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
                ctx.addIssue({ code: "custom", message: `${platform} must link to ${allowed.join(" or ")}` });
            }
        });

const socialLinksSchema = z
    .object(Object.fromEntries(Object.keys(SOCIAL_LINK_HOSTS).map((platform) => [platform, socialLink(platform).optional()])))
    .strict()
    // drop cleared (empty) links; an object with nothing left is stored as null
    .transform((links) => {
        const kept = Object.fromEntries(Object.entries(links).filter(([, value]) => value));
        return Object.keys(kept).length > 0 ? kept : null;
    });

// Only these two fields can ever be changed here. `.strict()` makes anything else (role, status,
// email, ...) a 400 instead of being quietly dropped, so a bad client is told rather than ignored.
export const updateProfileSchema = z
    .object({
        bio: z
            .string()
            .max(BIO_MAX_LENGTH * 2) // generous raw limit before trimming; the real limit is checked below
            .transform((value) => value.replace(CONTROL_CHARS, "").trim())
            .pipe(z.string().max(BIO_MAX_LENGTH, { message: `bio must be at most ${BIO_MAX_LENGTH} characters` }))
            .transform((value) => (value === "" ? null : value))
            .nullable()
            .optional(),
        socialLinks: socialLinksSchema.nullable().optional(),
    })
    .strict()
    .refine((data) => data.bio !== undefined || data.socialLinks !== undefined, {
        message: "Provide bio and/or socialLinks",
    });

export const deleteAccountSchema = z.object({
    password: z.string({ error: "password is required" }).min(1, { message: "password is required" }).max(PASSWORD_MAX_LENGTH),
});

export const uploadPurposeSchema = z.object({
    purpose: z.enum(["cover", "inline"], { error: "purpose must be cover or inline" }),
});
