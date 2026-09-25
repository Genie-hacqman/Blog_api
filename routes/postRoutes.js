import express from "express";
import { createPost, getAllPosts, getPostById, updatePost, deletePost } from "../controllers/postController.js";
import { createPostSchema, updatePostSchema } from "../schemas/postSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { idempotent } from "../middleware/idempotency.js";

const router = express.Router();

// route to create a new post
router.post("/", authenticate, validate(createPostSchema), idempotent(), createPost);

// route to get all posts (public: returns previews, not full content)
router.get("/", getAllPosts);

// route to get a single post by id (full story requires login)
router.get("/:id", authenticate, getPostById);

// route to update a post
router.patch("/:id", authenticate, validate(updatePostSchema), updatePost);

// route to delete a post
router.delete("/:id", authenticate, deletePost);

export default router;
