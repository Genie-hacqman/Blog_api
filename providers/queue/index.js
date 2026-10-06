import { env } from "../../config/env.js";
import { createBullmqProvider } from "./bullmq.js";
import { createInlineProvider } from "./inline.js";

// The rest of the app only ever calls getQueue().add(name, data) (and the worker code calls process/repeat).
// "inline" runs jobs in this process; "bullmq" sends them through Redis. Importing bullmq opens no connection:
// that happens only when the BullMQ provider is created.
const factories = {
    inline: createInlineProvider,
    bullmq: () => createBullmqProvider({ url: env.REDIS_URL, prefix: env.QUEUE_PREFIX }),
};

let provider;

export const getQueue = () => {
    provider ??= factories[env.QUEUE_PROVIDER]();
    return provider;
};

export { createBullmqProvider, createInlineProvider };
