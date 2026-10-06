import { env } from "../../config/env.js";

// every value interpolated into HTML goes through this
export const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const page = (heading, bodyHtml) =>
    `<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;line-height:1.6;color:#222">` +
    `<h2 style="margin-bottom:16px">${escapeHtml(heading)}</h2>${bodyHtml}</div>`;

const button = (href, label) =>
    `<p><a href="${escapeHtml(href)}" style="display:inline-block;background:#8a2d1f;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">${escapeHtml(label)}</a></p>` +
    `<p style="font-size:13px;color:#666">If the button does not work, copy this link into your browser:<br>${escapeHtml(href)}</p>`;

export const verifyEmailTemplate = ({ firstName, token }) => {
    const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    return {
        subject: "Confirm your email address",
        text: `Hi ${firstName},\n\nConfirm your email address to start writing:\n${link}\n\nThe link works once and expires in 24 hours. If you did not create an account, ignore this email.`,
        html: page("Confirm your email", `<p>Hi ${escapeHtml(firstName)},</p><p>Confirm your email address to start writing.</p>${button(link, "Confirm email")}<p style="font-size:13px;color:#666">The link works once and expires in 24 hours. If you did not create an account, ignore this email.</p>`),
    };
};

export const resetPasswordTemplate = ({ firstName, token }) => {
    const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    return {
        subject: "Reset your password",
        text: `Hi ${firstName},\n\nSomeone asked to reset your password. Choose a new one here:\n${link}\n\nThe link works once and expires in 1 hour. If this was not you, ignore this email: your password has not changed.`,
        html: page("Reset your password", `<p>Hi ${escapeHtml(firstName)},</p><p>Someone asked to reset your password.</p>${button(link, "Choose a new password")}<p style="font-size:13px;color:#666">The link works once and expires in 1 hour. If this was not you, ignore this email: your password has not changed.</p>`),
    };
};

export const passwordChangedTemplate = ({ firstName }) => ({
    subject: "Your password was changed",
    text: `Hi ${firstName},\n\nThe password on your account was just changed and you were signed out everywhere else. If this was not you, reset your password now: ${env.APP_URL}/forgot-password`,
    html: page("Your password was changed", `<p>Hi ${escapeHtml(firstName)},</p><p>The password on your account was just changed and you were signed out everywhere else.</p><p>If this was not you, <a href="${escapeHtml(env.APP_URL)}/forgot-password">reset your password now</a>.</p>`),
});

export const welcomeTemplate = ({ firstName }) => ({
    subject: "Welcome",
    text: `Hi ${firstName},\n\nYour email is confirmed. You can start writing: ${env.APP_URL}/posts/new`,
    html: page("Welcome", `<p>Hi ${escapeHtml(firstName)},</p><p>Your email is confirmed.</p>${button(`${env.APP_URL}/posts/new`, "Start writing")}`),
});

export const accountDeletedTemplate = ({ firstName }) => ({
    subject: "Your account was deleted",
    text: `Hi ${firstName},\n\nYour account was deleted and your personal details were removed. Stories you published remain on the site under a generic "Deleted user" byline.\n\nIf you did not do this, contact support right away.`,
    html: page("Your account was deleted", `<p>Hi ${escapeHtml(firstName)},</p><p>Your account was deleted and your personal details were removed. Stories you published remain on the site under a generic "Deleted user" byline.</p><p>If you did not do this, contact support right away.</p>`),
});

// Strip line breaks and other control characters: a subject must stay one line (no header injection), whatever
// a story title or a name contains.
const oneLine = (value, max = 150) => {
    const text = [...String(value)].filter((char) => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127).join("").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// An email about something that happened to the reader (a comment, a follower, a decision on their story).
// headline: one sentence; detail: an optional second paragraph (a comment excerpt, an editor's reason);
// url: where to look; unsubscribeUrl: turns this kind of email off.
export const notificationTemplate = ({ firstName, headline, detail, url, unsubscribeUrl, unsubscribeLabel }) => ({
    subject: oneLine(headline),
    text: `Hi ${oneLine(firstName, 60)},\n\n${headline}\n${detail ? `\n${detail}\n` : ""}\nSee it: ${url}\n\n--\nYou get this because of your notification settings. Stop "${unsubscribeLabel}" emails: ${unsubscribeUrl}`,
    html: page(
        headline,
        `<p>Hi ${escapeHtml(firstName)},</p>${detail ? `<blockquote style="margin:16px 0;padding-left:12px;border-left:3px solid #ccc;color:#444;white-space:pre-wrap">${escapeHtml(detail)}</blockquote>` : ""}${button(url, "See it")}` +
            `<p style="font-size:12px;color:#666">You get this because of your notification settings. <a href="${escapeHtml(unsubscribeUrl)}">Stop “${escapeHtml(unsubscribeLabel)}” emails</a>.</p>`,
    ),
});

export const accountSuspendedTemplate = ({ firstName, reason }) => ({
    subject: "Your account was suspended",
    text: `Hi ${firstName},\n\nYour account was suspended by a site administrator. Reason: ${reason}\n\nYou cannot log in while it is suspended. If you think this is a mistake, reply to this email or contact support.`,
    html: page("Your account was suspended", `<p>Hi ${escapeHtml(firstName)},</p><p>Your account was suspended by a site administrator.</p><blockquote style="margin:16px 0;padding-left:12px;border-left:3px solid #ccc;color:#444;white-space:pre-wrap">${escapeHtml(reason)}</blockquote><p>You cannot log in while it is suspended. If you think this is a mistake, reply to this email or contact support.</p>`),
});

export const accountReinstatedTemplate = ({ firstName }) => ({
    subject: "Your account is active again",
    text: `Hi ${firstName},\n\nYour account was reinstated. You can log in again: ${env.APP_URL}/login`,
    html: page("Your account is active again", `<p>Hi ${escapeHtml(firstName)},</p><p>Your account was reinstated.</p>${button(`${env.APP_URL}/login`, "Log in")}`),
});
