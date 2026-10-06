import express from "express";
import { create, list, remove, show, update } from "../controllers/categoryController.js";
import { createCategorySchema, updateCategorySchema } from "../schemas/taxonomySchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission } from "../middleware/authorize.js";

const router = express.Router();

// the sections of the publication are public
router.get("/", list);
router.get("/:slug", show);

// editors and admins keep them tidy; authors only choose from the list
router.post("/", authenticate, requirePermission("category:manage"), validate(createCategorySchema), create);
router.patch("/:id", authenticate, requirePermission("category:manage"), validate(updateCategorySchema), update);
router.delete("/:id", authenticate, requirePermission("category:manage"), remove);

export default router;
