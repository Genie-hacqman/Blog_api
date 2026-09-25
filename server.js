import dotenv from 'dotenv';
dotenv.config()
import sequelize from './database/dbconnection.js';
import app from './app.js';

const PORT = process.env.PORT || 3030;

// START SERVER
const startServer = async () => {
    try {
    await sequelize.authenticate();
    console.log("Database connection has been established successfully.");
    app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    });
    } catch (error) {
    console.error("Unable to connect to the database:", error); 
    }
}

startServer();
