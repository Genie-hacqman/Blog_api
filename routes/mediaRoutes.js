import express from "express";
import { remove, upload } from "../controllers/mediaController.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission, requireVerifiedEmail } from "../middleware/authorize.js";
import { uploadRateLimiter } from "../middleware/rateLimiter.js";
import { uploadSingleImage } from "../middleware/upload.js";

const router = express.Router();

// post images (cover, inline). Authorization runs before the body is read, so a rejected caller never costs an upload.
router.post("/", authenticate, requirePermission("media:upload_post_image"), requireVerifiedEmail, uploadRateLimiter, uploadSingleImage, upload);

router.delete("/:id", authenticate, requirePermission("media:delete_own"), remove);

export default router;
