import { env } from "../config/env.js";
import logger from "../config/logger.js";
import { SWEEP_INTERVAL_HOURS } from "../config/media.js";
import { getQueue } from "../providers/queue/index.js";

// The periodic jobs: publishing scheduled posts (every SCHEDULER_INTERVAL_SECONDS) and removing unused images
// (every few hours). They are registered with the queue as repeating jobs: with the in-process queue that is a
// timer in this process (first run now, to catch up on anything that came due while the server was down); with
// Redis it is one schedule shared by every instance, so the work runs once per interval, not once per instance.
// Returns a function that stops the repeating jobs of this process (and closes the queue's connections).
export const startScheduler = () => {
    const queue = getQueue();
    const register = (name, everySeconds) =>
        queue.repeat(name, everySeconds).catch((error) => logger.error({ err: error, job: name }, "Could not schedule job"));

    void register("publish-scheduled", env.SCHEDULER_INTERVAL_SECONDS);
    void register("sweep-media", SWEEP_INTERVAL_HOURS * 60 * 60);
    void register("purge-analytics", 24 * 60 * 60);

    return () => queue.close();
};
