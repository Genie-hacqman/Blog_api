import express from "express";
import { list, remove, rename, show } from "../controllers/tagController.js";
import { renameTagSchema } from "../schemas/taxonomySchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { requirePermission } from "../middleware/authorize.js";

const router = express.Router();

// topics in use are public (popular first; ?q= narrows the list for autocomplete)
router.get("/", list);
router.get("/:slug", show);

// tags are created by authors as they write; editors rename or remove them
router.patch("/:id", authenticate, requirePermission("tag:manage"), validate(renameTagSchema), rename);
router.delete("/:id", authenticate, requirePermission("tag:manage"), remove);

export default router;
