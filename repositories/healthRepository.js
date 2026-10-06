import sequelize from "../database/dbconnection.js";

// cheapest possible round trip to confirm the database connection works
export const pingDatabase = async () => {
    await sequelize.query("SELECT 1");
};
