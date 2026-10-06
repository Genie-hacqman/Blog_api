import { env } from "../../config/env.js";
import { JOB_DEFAULTS, QUEUE_OF } from "../../config/queues.js";
import logger from "../../config/logger.js";

// The queue without Redis: jobs run in this process, on the next turn of the event loop, with the same retry
// rules as BullMQ. Used when REDIS_URL is not set and in tests. A job that is still waiting when the process
// stops is lost, which is why production should use Redis.
export const createInlineProvider = () => {
    let handlers = null;
    const pending = new Set();
    const timers = new Map();
    const running = new Set();

    const handlerFor = async (name) => {
        // resolved lazily, so this module does not import the services that import it
        handlers ??= (await import("../../jobs/handlers.js")).handlers;
        return handlers[name];
    };

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const runJob = async (name, data, { attempts = JOB_DEFAULTS.attempts, backoffMs = JOB_DEFAULTS.backoffMs } = {}) => {
        const handler = await handlerFor(name);
        if (!handler) {
            logger.warn({ job: name }, "No handler for job");
            return;
        }
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                await handler(data);
                return;
            } catch (error) {
                if (attempt >= attempts) {
                    logger.error({ err: error, job: name, attempts }, "Job failed for good");
                    return;
                }
                logger.warn({ err: error, job: name, attempt }, "Job failed, will try again");
                await wait(env.isTest ? 0 : backoffMs * 2 ** (attempt - 1));
            }
        }
    };

    const track = (promise) => {
        pending.add(promise);
        promise.finally(() => pending.delete(promise));
        return promise;
    };

    return {
        name: "inline",

        // never throws and never waits for the job: an enqueue is a side effect of something that already succeeded
        async add(name, data = {}, options = {}) {
            if (!QUEUE_OF[name]) throw new Error(`Unknown job "${name}"`);
            track(new Promise((resolve) => setImmediate(resolve)).then(() => runJob(name, data, options)));
        },

        // BullMQ needs this call to start workers; here jobs always run, but a given set of handlers may be supplied
        process(given) {
            handlers = given;
        },

        // run a job every `everySeconds`, starting now (so work that came due while the server was down is caught up);
        // a run is skipped while the previous one is still going
        async repeat(name, everySeconds, data = {}) {
            if (!QUEUE_OF[name]) throw new Error(`Unknown job "${name}"`);
            if (timers.has(name)) return;
            const tick = () => {
                if (running.has(name)) return;
                running.add(name);
                track(runJob(name, data, { attempts: 1 }).finally(() => running.delete(name)));
            };
            tick();
            const timer = setInterval(tick, everySeconds * 1000);
            timer.unref();
            timers.set(name, timer);
        },

        // tests: resolves when every job added so far (and any job those added) has finished
        async idle() {
            while (pending.size > 0) await Promise.allSettled(pending);
        },

        async health() {
            return "inline";
        },

        // stops the repeating jobs; the provider can be used again afterwards
        async close() {
            for (const timer of timers.values()) clearInterval(timer);
            timers.clear();
            await this.idle();
        },
    };
};
