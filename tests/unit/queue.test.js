import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInlineProvider } from "../../providers/queue/index.js";
import { QUEUE_OF } from "../../config/queues.js";

describe("the in-process queue", () => {
    it("runs a job with its data on a later turn, and idle() waits for it", async () => {
        const queue = createInlineProvider();
        const seen = [];
        queue.process({ notify: async (data) => seen.push(data) });

        await queue.add("notify", { event: "comment", commentId: 7 });
        assert.deepEqual(seen, [], "add does not run the job inside the caller's turn");
        await queue.idle();

        assert.deepEqual(seen, [{ event: "comment", commentId: 7 }]);
    });

    it("refuses a job name it does not know", async () => {
        const queue = createInlineProvider();

        await assert.rejects(() => queue.add("send-spam", {}), /Unknown job/);
        await assert.rejects(() => queue.repeat("send-spam", 5), /Unknown job/);
    });

    it("tries a failing job again until it works", async () => {
        const queue = createInlineProvider();
        let calls = 0;
        queue.process({
            notify: async () => {
                calls += 1;
                if (calls < 3) throw new Error("flaky");
            },
        });

        await queue.add("notify", {});
        await queue.idle();

        assert.equal(calls, 3);
    });

    it("gives up after the last attempt without ever throwing to the caller", async () => {
        const queue = createInlineProvider();
        let calls = 0;
        queue.process({
            notify: async () => {
                calls += 1;
                throw new Error("always");
            },
        });

        await assert.doesNotReject(() => queue.add("notify", {}, { attempts: 3 }));
        await queue.idle();

        assert.equal(calls, 3);
    });

    it("idle() also waits for jobs that other jobs add", async () => {
        const queue = createInlineProvider();
        const order = [];
        queue.process({
            notify: async () => {
                order.push("notify");
                await queue.add("notification-email", {});
            },
            "notification-email": async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                order.push("email");
            },
        });

        await queue.add("notify", {});
        await queue.idle();

        assert.deepEqual(order, ["notify", "email"]);
    });

    it("repeats a job from now on, once per name however often it is registered", async () => {
        const queue = createInlineProvider();
        let runs = 0;
        queue.process({ "sweep-media": async () => (runs += 1) });

        await queue.repeat("sweep-media", 3600);
        await queue.repeat("sweep-media", 3600);
        await queue.idle();
        assert.equal(runs, 1, "one immediate run, not two");

        await queue.close();
        await queue.repeat("sweep-media", 3600);
        await queue.idle();
        assert.equal(runs, 2, "after close the same provider can schedule again");
        await queue.close();
    });

    it("knows every job it may be given, each on a queue", () => {
        for (const [job, queue] of Object.entries(QUEUE_OF)) {
            assert.ok(job && queue, `${job} needs a queue`);
        }
        assert.equal(QUEUE_OF["notification-email"], "emails");
    });

    it("reports itself as in-process", async () => {
        assert.equal(await createInlineProvider().health(), "inline");
    });
});
