import { env } from './config/env.js';
import logger from './config/logger.js';
import sequelize from './database/dbconnection.js';
import { getQueue } from './providers/queue/index.js';
import { handlers } from './jobs/handlers.js';

// A process that only runs background jobs (for deployments that keep them off the API: set WORKER_ENABLED=false
// there). It needs Redis; the in-process queue cannot be shared between processes.
if (env.QUEUE_PROVIDER !== 'bullmq') {
    logger.fatal('The worker needs Redis: set REDIS_URL (or QUEUE_PROVIDER=bullmq).');
    process.exit(1);
}

await sequelize.authenticate();
getQueue().process(handlers);
logger.info('Worker started');

const shutdown = async (signal) => {
    logger.info(`${signal} received, stopping the worker`);
    await getQueue().close();
    await sequelize.close();
    process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
