import express from "express";
import { postReport } from "../controllers/reportController.js";
import { createReportSchema } from "../schemas/reportSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission, requireVerifiedEmail } from "../middleware/authorize.js";
import { reportRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// any confirmed reader may flag a comment, a story or a person; reports never act on their own
router.post("/", authenticate, requirePermission("report:create"), requireVerifiedEmail, reportRateLimiter, validate(createReportSchema), postReport);

export default router;
