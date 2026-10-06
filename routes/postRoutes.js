import express from "express";
import {
    changeStatus,
    compare,
    createPost,
    deletePost,
    getAllPosts,
    getMyPosts,
    getPostById,
    getPostBySlug,
    getReviewQueue,
    getRevisionByVersion,
    getRevisions,
    restore,
    updatePost,
} from "../controllers/postController.js";
import { getComments, postComment } from "../controllers/commentController.js";
import { bookmark, getBookmarks, getFeedPosts, like, unbookmark, unlike } from "../controllers/engagementController.js";
import { createCommentSchema } from "../schemas/commentSchemas.js";
import { changeStatusSchema, createPostSchema, updatePostSchema } from "../schemas/postSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate, optionalAuthenticate } from "../middleware/authMiddleware.js";
import { idempotent } from "../middleware/idempotency.js";
import { requirePermission, requireVerifiedEmail } from "../middleware/authorize.js";
import { commentRateLimiter, reactionRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// create a post (always a draft unless the caller may publish without review)
router.post("/", authenticate, requirePermission("post:create"), requireVerifiedEmail, validate(createPostSchema), idempotent(), createPost);

// published posts, public: previews only
router.get("/", getAllPosts);

// fixed paths first, so "mine" and "review" are never read as post ids
router.get("/mine", authenticate, getMyPosts);
router.get("/review", authenticate, requirePermission("post:review"), getReviewQueue);
router.get("/bookmarks", authenticate, getBookmarks);
router.get("/feed", authenticate, getFeedPosts);
router.get("/slug/:slug", optionalAuthenticate, getPostBySlug);

// one post: public when published; its author (and editors, for review states) can see the rest
router.get("/:id", optionalAuthenticate, getPostById);

// comments on a post (published posts only; anything else answers 404)
router.get("/:id/comments", optionalAuthenticate, getComments);
router.post("/:id/comments", authenticate, requirePermission("comment:create"), requireVerifiedEmail, commentRateLimiter, validate(createCommentSchema), idempotent(), postComment);

// likes and bookmarks: PUT sets, DELETE clears, both are safe to repeat
router.put("/:id/like", authenticate, reactionRateLimiter, like);
router.delete("/:id/like", authenticate, reactionRateLimiter, unlike);
router.put("/:id/bookmark", authenticate, reactionRateLimiter, bookmark);
router.delete("/:id/bookmark", authenticate, reactionRateLimiter, unbookmark);

router.patch("/:id", authenticate, validate(updatePostSchema), updatePost);
router.post("/:id/status", authenticate, validate(changeStatusSchema), changeStatus);
router.delete("/:id", authenticate, deletePost);

// history
router.get("/:id/revisions", authenticate, getRevisions);
router.get("/:id/revisions/compare", authenticate, compare);
router.get("/:id/revisions/:version", authenticate, getRevisionByVersion);
router.post("/:id/revisions/:version/restore", authenticate, restore);

export default router;
