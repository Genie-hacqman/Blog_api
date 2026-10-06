import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

// Any SMTP service works (Resend, Postmark, SES, Mailgun...), so switching provider is configuration.
export const createSmtpProvider = () => {
    const transport = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });

    return {
        name: "smtp",
        async send({ to, subject, text, html, headers }) {
            await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text, html, headers });
        },
    };
};
