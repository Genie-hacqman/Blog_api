import { pingDatabase } from "../repositories/healthRepository.js";
import { getQueue } from "../providers/queue/index.js";
import logger from "../config/logger.js";

// reports only "up"/"down" per dependency: error details stay in the logs, not in a public response
export const getHealth = async () => {
    let database = "up";
    try {
        await pingDatabase();
    } catch (error) {
        logger.error({ err: error }, "Health check: database unreachable");
        database = "down";
    }

    // informational: the API keeps working while the queue is away (events are logged and dropped), so it
    // does not turn the status to "degraded" and a load balancer does not pull the instance out
    const queue = await getQueue().health();

    return {
        status: database === "up" ? "ok" : "degraded",
        uptime: Math.round(process.uptime()),
        checks: { database, queue },
    };
};
