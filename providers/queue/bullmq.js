import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { JOB_DEFAULTS, KEEP_COMPLETED, KEEP_FAILED, QUEUES, QUEUE_OF } from "../../config/queues.js";
import logger from "../../config/logger.js";

const HEALTH_TIMEOUT_MS = 750;
const READY_TIMEOUT_MS = 1500;
const LOG_EVERY_MS = 30_000;

const timeout = (ms, message) => new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref());

// The queue on Redis (BullMQ). `url` is a secret (it can hold a password) and is never logged.
export const createBullmqProvider = ({ url, prefix = "blog", concurrency = 5 } = {}) => {
    const connections = new Set();
    const workers = [];
    let queues = null;

    // ioredis emits "error" for every failed reconnect; log it, but not on every attempt
    let lastLogged = 0;
    const watch = (connection, role) => {
        connection.on("error", (error) => {
            if (Date.now() - lastLogged < LOG_EVERY_MS) return;
            lastLogged = Date.now();
            logger.warn({ err: { message: error.message, code: error.code }, role }, "Redis connection problem");
        });
        connections.add(connection);
        return connection;
    };

    // Producers (the API adding jobs) must fail fast when Redis is away: a request is never held up for it.
    const producer = watch(new IORedis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false }), "producer");

    const getQueues = () => {
        queues ??= new Map(
            QUEUES.map((name) => [
                name,
                new Queue(name, {
                    connection: producer,
                    prefix,
                    defaultJobOptions: {
                        attempts: JOB_DEFAULTS.attempts,
                        backoff: { type: "exponential", delay: JOB_DEFAULTS.backoffMs },
                        removeOnComplete: { count: KEEP_COMPLETED },
                        removeOnFail: { count: KEEP_FAILED },
                    },
                }),
            ]),
        );
        return queues;
    };

    // with no offline queue, a command sent before the connection is ready would be refused: wait briefly for it
    const ready = async () => {
        if (producer.status === "ready") return;
        await Promise.race([new Promise((resolve) => producer.once("ready", resolve)), timeout(READY_TIMEOUT_MS, "Redis is not reachable")]);
    };

    const queueFor = (name) => {
        const queueName = QUEUE_OF[name];
        if (!queueName) throw new Error(`Unknown job "${name}"`);
        return getQueues().get(queueName);
    };

    return {
        name: "bullmq",

        // Rejects if Redis cannot be reached; callers (publishEvent) log that and carry on.
        async add(name, data = {}, options = {}) {
            const queue = queueFor(name);
            await ready();
            const { attempts, backoffMs, ...rest } = options;
            await queue.add(name, data, {
                ...rest,
                ...(attempts && { attempts }),
                ...(backoffMs && { backoff: { type: "exponential", delay: backoffMs } }),
            });
        },

        // Start the workers: one per queue, each running the handler named like the job.
        process(handlers) {
            const queueNames = new Set(Object.keys(handlers).map((name) => QUEUE_OF[name]).filter(Boolean));
            for (const queueName of queueNames) {
                // a worker waits on Redis with a blocking command, so it needs its own connection that never gives up
                const connection = watch(new IORedis(url, { maxRetriesPerRequest: null }), `worker:${queueName}`);
                const worker = new Worker(
                    queueName,
                    async (job) => {
                        const handler = handlers[job.name];
                        if (!handler) throw new Error(`No handler for job "${job.name}"`);
                        return handler(job.data);
                    },
                    { connection, prefix, concurrency },
                );
                worker.on("failed", (job, error) =>
                    logger.warn({ err: { message: error.message }, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade }, "Job failed"),
                );
                worker.on("error", (error) => logger.warn({ err: { message: error.message }, queue: queueName }, "Worker problem"));
                workers.push(worker);
            }
        },

        // Run a job every `everySeconds`. Registering the same name again (from this or another instance) updates
        // the one schedule instead of adding another, so the job runs once per interval across all instances.
        async repeat(name, everySeconds, data = {}) {
            const queue = queueFor(name);
            await ready();
            await queue.upsertJobScheduler(`repeat:${name}`, { every: everySeconds * 1000 }, { name, data });
        },

        // tests: resolves when nothing is waiting, delayed or running
        async idle(maxWaitMs = 15_000) {
            const deadline = Date.now() + maxWaitMs;
            for (;;) {
                const counts = await Promise.all([...getQueues().values()].map((queue) => queue.getJobCounts("waiting", "active", "delayed", "prioritized")));
                if (counts.every((count) => Object.values(count).every((n) => n === 0))) return;
                if (Date.now() > deadline) throw new Error("The queue did not become idle in time");
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        },

        // "up" or "down", quickly; never throws
        async health() {
            try {
                await Promise.race([producer.ping(), timeout(HEALTH_TIMEOUT_MS, "ping timed out")]);
                return "up";
            } catch {
                return "down";
            }
        },

        // tests: remove every job of this prefix (never touches other prefixes)
        async obliterate() {
            await ready();
            for (const queue of getQueues().values()) await queue.obliterate({ force: true });
        },

        async close() {
            await Promise.allSettled(workers.splice(0).map((worker) => worker.close()));
            if (queues) await Promise.allSettled([...queues.values()].map((queue) => queue.close()));
            queues = null;
            for (const connection of connections) connection.disconnect();
            connections.clear();
        },
    };
};
