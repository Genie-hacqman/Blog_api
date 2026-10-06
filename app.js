import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { localRoot } from './providers/storage/localDisk.js';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/authRoutes.js';
import router from './routes/userRoutes.js';
import adminRouter from './routes/adminRoutes.js';
import postRouter from './routes/postRoutes.js';
import mediaRouter from './routes/mediaRoutes.js';
import categoryRouter from './routes/categoryRoutes.js';
import tagRouter from './routes/tagRoutes.js';
import searchRouter from './routes/searchRoutes.js';
import commentRouter from './routes/commentRoutes.js';
import notificationRouter from './routes/notificationRoutes.js';
import reportRouter from './routes/reportRoutes.js';
import moderationRouter from './routes/moderationRoutes.js';
import analyticsRouter from './routes/analyticsRoutes.js';
import healthRouter from './routes/healthRoutes.js';
import seoRouter from './routes/seoRoutes.js';
const app = express();

// number of reverse proxies in front of the app, so req.ip (and the rate limiters) see the real client
app.set('trust proxy', env.TRUST_PROXY);

app.use(requestLogger);
app.use(helmet());

// development only: serve uploaded images from the local folder. In production they are served
// straight from the bucket's own domain, so the API never handles image traffic.
if (env.STORAGE_PROVIDER === 'local') {
    app.use('/media', express.static(localRoot(), {
        dotfiles: 'deny',
        index: false,
        setHeaders: (res) => {
            // file names are random and never reused, so they can be cached forever
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            // helmet's default (same-origin) would stop a frontend on another origin from showing them
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        },
    }));
}

// posts are capped at 50,000 characters (see schemas/postSchemas.js); this leaves room for multi-byte text
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// only the configured frontend origin(s) may call the API from a browser;
// comma-separate multiple origins, e.g. "http://localhost:5173,https://blog.example.com"
// credentials: the browser may send the refresh-token cookie, but only from the origins above
app.use(cors({ origin: env.CLIENT_ORIGINS, credentials: true }));

app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", router);
app.use("/api/admin", adminRouter);
app.use("/api/media", mediaRouter);
app.use("/api/categories", categoryRouter);
app.use("/api/tags", tagRouter);
app.use("/api/search", searchRouter);
app.use("/api/posts", postRouter);
app.use("/api/comments", commentRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/moderation", moderationRouter);
app.use("/api/analytics", analyticsRouter);
// robots.txt, sitemaps, feeds and crawler snapshots (SEO_ENABLED)
app.use(seoRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
