import { getEmailProvider } from "../providers/email/index.js";
import {
    accountDeletedTemplate,
    accountReinstatedTemplate,
    accountSuspendedTemplate,
    passwordChangedTemplate,
    resetPasswordTemplate,
    verifyEmailTemplate,
    welcomeTemplate,
} from "../providers/email/templates.js";
import logger from "../config/logger.js";

// Email is a side effect of an action that already succeeded, so a delivery failure is
// logged (without the message body, which holds the token) and never fails the request.
const deliver = async (user, template, kind) => {
    try {
        await getEmailProvider().send({ to: user.email, ...template });
    } catch (error) {
        logger.error({ err: error, userId: user.id, kind }, "Failed to send email");
    }
};

export const sendVerificationEmail = (user, token) => deliver(user, verifyEmailTemplate({ firstName: user.firstName, token }), "verify_email");
export const sendPasswordResetEmail = (user, token) => deliver(user, resetPasswordTemplate({ firstName: user.firstName, token }), "reset_password");
export const sendPasswordChangedEmail = (user) => deliver(user, passwordChangedTemplate({ firstName: user.firstName }), "password_changed");
export const sendWelcomeEmail = (user) => deliver(user, welcomeTemplate({ firstName: user.firstName }), "welcome");
export const sendAccountSuspendedEmail = (user, reason) => deliver(user, accountSuspendedTemplate({ firstName: user.firstName, reason }), "account_suspended");
export const sendAccountReinstatedEmail = (user) => deliver(user, accountReinstatedTemplate({ firstName: user.firstName }), "account_reinstated");
export const sendAccountDeletedEmail = (user) => deliver(user, accountDeletedTemplate({ firstName: user.firstName }), "account_deleted");
