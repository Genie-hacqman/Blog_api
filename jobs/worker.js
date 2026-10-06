import { env } from "../config/env.js";
import { getQueue } from "../providers/queue/index.js";
import { handlers } from "./handlers.js";

// Start processing jobs in this process. With Redis this starts the workers; the in-process queue always runs
// its jobs and only needs to know the handlers. Skipped when a separate `npm run worker` process does the work.
export const startWorker = () => {
    if (!env.WORKER_ENABLED) return false;
    getQueue().process(handlers);
    return true;
};
