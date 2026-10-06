import express from "express";
import { getMine, getPost, postReading, postView } from "../controllers/analyticsController.js";
import { readingSchema, viewSchema } from "../schemas/analyticsSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate, softAuthenticate } from "../middleware/authMiddleware.js";
import { requirePermission } from "../middleware/authorize.js";
import { analyticsRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// What a reader's browser reports. Public, and always answered 204 (see the controller); soft authentication only
// so that an author's own visits can be left out.
router.post("/view", analyticsRateLimiter, softAuthenticate, validate(viewSchema), postView);
router.post("/reading", analyticsRateLimiter, softAuthenticate, validate(readingSchema), postReading);

// authors read their own numbers (one story: its owner or an admin, anyone else gets 404)
router.get("/me", authenticate, requirePermission("analytics:read_own"), getMine);
router.get("/posts/:id", authenticate, requirePermission("analytics:read_own"), getPost);

export default router;
