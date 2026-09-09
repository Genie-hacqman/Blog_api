import express from 'express';
import cors from 'cors';
import router from './routes/userRoutes.js';

const app = express();



app.use(express.json());
app.use(cors());
app.use("/api/users", router);
app.use(express.urlencoded({ extended: true }));

export default app;