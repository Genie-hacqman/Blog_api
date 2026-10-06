import { env } from './config/env.js';
import logger from './config/logger.js';
import sequelize from './database/dbconnection.js';
import { migrator } from './database/migrator.js';
import app from './app.js';
import { startScheduler } from './jobs/scheduler.js';
import { startWorker } from './jobs/worker.js';
import { getQueue } from './providers/queue/index.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

// schema changes are migrations now (see database/migrations). In development they are
// applied automatically; elsewhere a pending one stops the boot so the app never runs
// against a schema it does not expect.
const prepareSchema = async () => {
    if (env.AUTO_MIGRATE) {
        await migrator.up();
        return;
    }
    const pending = await migrator.pending();
    if (pending.length > 0) {
        throw new Error(
            `${pending.length} pending database migration(s): ${pending.map((m) => m.name).join(", ")}. ` +
                'Run "npm run migrate" (or set AUTO_MIGRATE=true) and start again.',
        );
    }
};

// START SERVER
const startServer = async () => {
    await sequelize.authenticate();
    logger.info("Database connection has been established successfully.");
    await prepareSchema();

    const server = app.listen(env.PORT, () => {
        logger.info(`Server is running on port ${env.PORT}`);
    });

    // background jobs: notification emails, publishing scheduled posts, removing unused images
    if (env.isProduction && env.QUEUE_PROVIDER === 'inline') {
        logger.warn('REDIS_URL is not set: jobs run inside this process and are lost if it restarts. Use Redis in production.');
    }
    startWorker();
    const stopScheduler = env.SCHEDULER_ENABLED ? startScheduler() : () => {};

    // stop taking new connections, let in-flight requests finish, then release the DB pool
    const shutdown = (signal) => {
        logger.info(`${signal} received, shutting down`);
        stopScheduler();
        const forceExit = setTimeout(() => {
            logger.error("Shutdown timed out, forcing exit");
            process.exit(1);
        }, SHUTDOWN_TIMEOUT_MS);
        forceExit.unref();

        server.close(async () => {
            await getQueue().close();
            await sequelize.close();
            process.exit(0);
        });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection');
    process.exit(1);
});

startServer().catch((error) => {
    logger.fatal({ err: error }, 'Unable to start the server');
    process.exit(1);
});
