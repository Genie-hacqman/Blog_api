import express from "express";
import {
    deleteNotification,
    getCount,
    getMyPreferences,
    getNotifications,
    postRead,
    postUnsubscribe,
    putMyPreferences,
} from "../controllers/notificationController.js";
import { markReadSchema, preferencesSchema } from "../schemas/notificationSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { notificationRateLimiter, unsubscribeRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// fixed paths first, so "preferences" and "unread-count" are never read as notification ids
router.get("/", authenticate, notificationRateLimiter, getNotifications);
router.get("/unread-count", authenticate, notificationRateLimiter, getCount);
router.post("/read", authenticate, validate(markReadSchema), postRead);
router.get("/preferences", authenticate, getMyPreferences);
router.put("/preferences", authenticate, validate(preferencesSchema), putMyPreferences);
router.post("/unsubscribe", unsubscribeRateLimiter, postUnsubscribe);
router.delete("/:id", authenticate, deleteNotification);

export default router;
