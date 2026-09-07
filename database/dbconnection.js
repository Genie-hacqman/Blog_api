import {Sequelize} from "sequelize";
import dotenv from "dotenv";
dotenv.config();

// DB environment variables
const {DB_NAME, DB_USER, DB_PASSWORD, DB_HOST,} = process.env;

// create a new Sequelize instance with the database connection details
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    dialect: "mysql",
    
});

export default sequelize;
