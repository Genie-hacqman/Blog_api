import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { Umzug, SequelizeStorage } from "umzug";
import sequelize from "./dbconnection.js";
import logger from "../config/logger.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Schema changes live in database/migrations/*.js and are applied in filename order.
// Applied migrations are recorded in the SequelizeMeta table. Each migration exports
// `up({ context })` and `down({ context })`, where context is the Sequelize queryInterface.
export const migrator = new Umzug({
    migrations: {
        glob: ["*.js", { cwd: migrationsDir }],
        resolve: ({ name, path: filePath, context }) => {
            const load = () => import(pathToFileURL(filePath).href);
            return {
                name,
                up: async () => (await load()).up({ context }),
                down: async () => (await load()).down({ context }),
            };
        },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger,
});
