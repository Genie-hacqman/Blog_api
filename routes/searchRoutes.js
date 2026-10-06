import express from "express";
import { search } from "../controllers/searchController.js";
import { searchRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// public, but every call is a ranked full-text query, so it is rate limited
router.get("/", searchRateLimiter, search);

export default router;
