import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createBullmqProvider } from "../providers/queue/index.js";

// These need a real Redis (BullMQ cannot run against a mock). Point TEST_REDIS_URL at a throwaway database,
// e.g. TEST_REDIS_URL=redis://127.0.0.1:6379/15. Every test uses its own key prefix and removes it afterwards.
const url = process.env.TEST_REDIS_URL;
const skip = url ? false : "set TEST_REDIS_URL to run the BullMQ tests (needs a Redis server)";

const withProvider = async (work, options = {}) => {
    const prefix = `test-${randomUUID().slice(0, 8)}`;
    const provider = createBullmqProvider({ url, prefix, ...options });
    try {
        await work(provider, prefix);
    } finally {
        await provider.obliterate().catch(() => {});
        await provider.close();
    }
};

// a plain BullMQ queue on the same prefix, to look at what the provider left in Redis
const inspect = async (prefix, queueName, work) => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue(queueName, { connection, prefix });
    try {
        return await work(queue);
    } finally {
        await queue.close();
        connection.disconnect();
    }
};

describe("the BullMQ queue", { skip }, () => {
    it("runs a job through a real worker", async () => {
        await withProvider(async (provider) => {
            const seen = [];
            provider.process({ notify: async (data) => seen.push(data) });

            await provider.add("notify", { event: "comment", commentId: 7 });
            await provider.idle();

            assert.deepEqual(seen, [{ event: "comment", commentId: 7 }]);
            assert.equal(await provider.health(), "up");
        });
    });

    it("tries a failing job again with a backoff until it works", async () => {
        await withProvider(async (provider) => {
            let calls = 0;
            provider.process({
                notify: async () => {
                    calls += 1;
                    if (calls < 3) throw new Error("flaky");
                },
            });

            await provider.add("notify", {}, { attempts: 4, backoffMs: 20 });
            await provider.idle();

            assert.equal(calls, 3);
        });
    });

    it("keeps a job that never works in the failed list, after exactly the allowed attempts", async () => {
        await withProvider(async (provider, prefix) => {
            let calls = 0;
            provider.process({
                notify: async () => {
                    calls += 1;
                    throw new Error("always");
                },
            });

            await provider.add("notify", {}, { attempts: 2, backoffMs: 20 });
            await provider.idle();
            await new Promise((resolve) => setTimeout(resolve, 100));

            assert.equal(calls, 2);
            const counts = await inspect(prefix, "notifications", (queue) => queue.getJobCounts("failed"));
            assert.equal(counts.failed, 1);
        });
    });

    it("keeps one schedule however many instances register it", async () => {
        const prefix = `test-${randomUUID().slice(0, 8)}`;
        const first = createBullmqProvider({ url, prefix });
        const second = createBullmqProvider({ url, prefix });
        try {
            await first.repeat("sweep-media", 3600);
            await second.repeat("sweep-media", 3600);
            await first.repeat("sweep-media", 3600);

            const schedulers = await inspect(prefix, "maintenance", (queue) => queue.getJobSchedulers());
            assert.equal(schedulers.length, 1);
        } finally {
            await first.obliterate().catch(() => {});
            await first.close();
            await second.close();
        }
    });

    it("sends each job to its own queue", async () => {
        await withProvider(async (provider, prefix) => {
            await provider.add("notify", { a: 1 });
            await provider.add("notification-email", { b: 2 });

            const waiting = async (name) => inspect(prefix, name, (queue) => queue.getJobCounts("waiting"));
            assert.equal((await waiting("notifications")).waiting, 1);
            assert.equal((await waiting("emails")).waiting, 1);
            assert.equal((await waiting("maintenance")).waiting, 0);
        });
    });

    it("refuses a job name it does not know", async () => {
        await withProvider(async (provider) => {
            await assert.rejects(() => provider.add("send-spam", {}), /Unknown job/);
        });
    });
});

describe("the BullMQ queue when Redis is away", { skip }, () => {
    it("fails an add quickly instead of holding the caller up, and reports itself down", async () => {
        // nothing listens on port 1
        const provider = createBullmqProvider({ url: "redis://127.0.0.1:1", prefix: "test-away" });
        try {
            const started = Date.now();
            await assert.rejects(() => provider.add("notify", { event: "comment" }));
            assert.ok(Date.now() - started < 4000, `add took ${Date.now() - started} ms`);
            assert.equal(await provider.health(), "down");
        } finally {
            await provider.close();
        }
    });
});
