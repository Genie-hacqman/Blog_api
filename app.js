import express from 'express';
import cors from 'cors';
import router from './routes/userRoutes.js';
import postRouter from './routes/postRoutes.js';

const app = express();



app.use(express.json());

// only the configured frontend origin(s) may call the API from a browser;
// comma-separate multiple origins, e.g. "http://localhost:5173,https://blog.example.com"

const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim());
app.use(cors({ origin: allowedOrigins }));
app.use("/api/users", router);
app.use("/api/posts", postRouter);
app.use(express.urlencoded({ extended: true }));

export default app;