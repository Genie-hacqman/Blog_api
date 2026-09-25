import {Sequelize} from "sequelize";
import dotenv from "dotenv";
dotenv.config();

// DB environment variables
const {DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT} = process.env;

// Validate required env vars
if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
    console.error("Error: Missing required database environment variables:");
    console.error(`  DB_HOST: ${DB_HOST ? "set" : "MISSING"}`);
    console.error(`  DB_NAME: ${DB_NAME ? "set" : "MISSING"}`);
    console.error(`  DB_USER: ${DB_USER ? "set" : "MISSING"}`);
    console.error(`  DB_PASSWORD: ${DB_PASSWORD ? "set" : "MISSING"}`);
    process.exit(1);
}

console.log(`Connecting to MySQL at ${DB_HOST}:${DB_PORT || 3306}/${DB_NAME} as ${DB_USER}`);

// create a new Sequelize instance with the database connection details
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT || 3306,
    dialect: "mysql",
    logging: false,
});

export default sequelize;

