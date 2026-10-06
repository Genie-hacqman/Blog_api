import { env } from "../../config/env.js";
import { createConsoleProvider } from "./console.js";
import { createMemoryProvider } from "./memory.js";
import { createSmtpProvider } from "./smtp.js";

// the rest of the app only ever calls getEmailProvider().send({ to, subject, text, html })
const factories = {
    console: createConsoleProvider,
    memory: createMemoryProvider,
    smtp: createSmtpProvider,
};

let provider;

export const getEmailProvider = () => {
    provider ??= factories[env.EMAIL_PROVIDER]();
    return provider;
};
