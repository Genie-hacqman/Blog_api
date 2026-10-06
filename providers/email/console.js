import logger from "../../config/logger.js";

// Development only: prints the email instead of sending it, so verification and reset
// links can be copied from the terminal. env.js refuses this provider in production.
export const createConsoleProvider = () => ({
    name: "console",
    async send({ to, subject, text, headers }) {
        logger.info({ to, subject, headers }, `Email (not sent, console provider):\n${text}`);
    },
});
