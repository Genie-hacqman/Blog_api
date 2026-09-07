import express from 'express';
import dotenv from 'dotenv';
dotenv.config();
import sequelize from './database/dbconnection.js';

//initialize express app
const app = express();

const PORT = process.env.PORT || 5000;

// START SERVER
const startServer = async () => {
    try {
    await sequelize.authenticate();
    console.log("Database connection has been established successfully.");
    app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    });
    } catch (error) {
    console.error("Unable to connect to the database:", error); 
    }

}

startServer();
