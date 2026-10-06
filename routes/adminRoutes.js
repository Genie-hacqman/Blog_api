import express from "express";
import { getSite } from "../controllers/analyticsController.js";
import {
    changeUserRole,
    getStats,
    getUser,
    getUsers,
    listAuditLogs,
    postSignOut,
    postSuspend,
    postUnsuspend,
} from "../controllers/adminController.js";
import { setRoleSchema } from "../schemas/authSchemas.js";
import { suspendSchema } from "../schemas/adminSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission } from "../middleware/authorize.js";

const router = express.Router();

// every admin route is authenticated here and permission-checked per route; the server decides, never the UI
router.use(authenticate);

router.get("/stats", requirePermission("stats:read"), getStats);
router.get("/analytics", requirePermission("analytics:read_all"), getSite);
router.get("/users", requirePermission("user:read"), getUsers);
router.get("/users/:id", requirePermission("user:read"), getUser);
router.post("/users/:id/suspend", requirePermission("user:suspend"), validate(suspendSchema), postSuspend);
router.post("/users/:id/unsuspend", requirePermission("user:suspend"), postUnsuspend);
router.post("/users/:id/sign-out", requirePermission("user:suspend"), postSignOut);
router.patch("/users/:id/role", requirePermission("user:set_role"), validate(setRoleSchema), changeUserRole);
router.get("/audit-logs", requirePermission("audit:read"), listAuditLogs);

export default router;
