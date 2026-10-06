import express from "express";
import { getQueue, getReport, postResolve } from "../controllers/moderationController.js";
import { resolveReportSchema } from "../schemas/reportSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission } from "../middleware/authorize.js";

const router = express.Router();

// editors and admins; which kinds of report each may see is decided in the service (people are admin-only)
router.use(authenticate, requirePermission("report:review"));

router.get("/reports", getQueue);
router.get("/reports/:id", getReport);
router.post("/reports/:id/resolve", validate(resolveReportSchema), postResolve);

export default router;
