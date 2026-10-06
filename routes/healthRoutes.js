import express from "express";
import { checkHealth } from "../controllers/healthController.js";

const router = express.Router();

// liveness + dependency check for load balancers and uptime monitors
router.get("/", checkHealth);

export default router;
