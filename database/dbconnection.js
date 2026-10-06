import { Sequelize } from "sequelize";
import { env } from "../config/env.js";

// create a new Sequelize instance with the database connection details.
// SQL logging is off: INSERT statements contain emails and password hashes.
const sequelize = new Sequelize(env.DB_NAME, env.DB_USER, env.DB_PASSWORD, {
    host: env.DB_HOST,
    port: env.DB_PORT,
    dialect: "mysql",
    logging: false,
    // An UPDATE reports the rows it MATCHED, not just the rows it changed. Without this, saving a
    // post with values identical to what is stored reports "0 rows" and looks like "not found".
    dialectOptions: { flags: ["+FOUND_ROWS"] },
    // tests fail fast: a request that is stuck waiting for a lock or a connection reports why within seconds
    // instead of hanging until the test runner gives up
    ...(env.isTest && { pool: { max: 5, acquire: 10_000 } }),
});

if (env.isTest) {
    sequelize.addHook("afterConnect", async (connection) => {
        await connection.promise().query("SET SESSION innodb_lock_wait_timeout = 8");
    });
}

export default sequelize;
