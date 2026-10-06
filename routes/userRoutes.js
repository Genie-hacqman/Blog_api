import express from "express";
import { becomeAuthor } from "../controllers/userContoller.js";
import {
    deleteAvatar,
    deleteMe,
    getPostsOfProfile,
    getProfile,
    putAvatar,
    updateMe,
} from "../controllers/profileController.js";
import { deleteAccountSchema, updateProfileSchema } from "../schemas/profileSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate, optionalAuthenticate } from "../middleware/authMiddleware.js";
import { followUser, getFollowers, getFollowing, unfollowUser } from "../controllers/followController.js";
import { requirePermission, requireVerifiedEmail } from "../middleware/authorize.js";
import { accountDeletionRateLimiter, reactionRateLimiter, uploadRateLimiter } from "../middleware/rateLimiter.js";
import { uploadSingleImage } from "../middleware/upload.js";

const router = express.Router();

// Registration, login and logout live under /api/auth (the old /api/users aliases are gone).

// the signed-in user's own account. These must be declared before /:username so "me" is never read as a username.
router.post("/me/become-author", authenticate, becomeAuthor);
router.patch("/me", authenticate, validate(updateProfileSchema), updateMe);
router.delete("/me", authenticate, accountDeletionRateLimiter, validate(deleteAccountSchema), deleteMe);
router.put("/me/avatar", authenticate, requirePermission("media:upload_avatar"), requireVerifiedEmail, uploadRateLimiter, uploadSingleImage, putAvatar);
router.delete("/me/avatar", authenticate, deleteAvatar);

// public profiles
router.get("/:username", optionalAuthenticate, getProfile);
router.get("/:username/posts", getPostsOfProfile);
router.get("/:username/followers", getFollowers);
router.get("/:username/following", getFollowing);

// following someone: PUT follows, DELETE unfollows, both are safe to repeat
router.put("/:username/follow", authenticate, reactionRateLimiter, followUser);
router.delete("/:username/follow", authenticate, reactionRateLimiter, unfollowUser);

export default router;
