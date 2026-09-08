import express from 'express';
import cors from 'cors';
import userRoutes from './routes/userRoutes.js';


export function createApp() {
    const app = express();
    app.use(express.json())
    app.use(cors())
    app.use(userRoutes);

    return app;
}

