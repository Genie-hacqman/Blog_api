import express from "express";
import { getReplies, patchComment, removeComment } from "../controllers/commentController.js";
import { updateCommentSchema } from "../schemas/commentSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate, optionalAuthenticate } from "../middleware/authMiddleware.js";

const router = express.Router();

// Creating a comment is POST /api/posts/:id/comments (see postRoutes). These address one existing comment.
router.get("/:id/replies", optionalAuthenticate, getReplies);
router.patch("/:id", authenticate, validate(updateCommentSchema), patchComment);
router.delete("/:id", authenticate, removeComment);

export default router;
