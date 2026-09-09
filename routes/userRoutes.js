import { Router } from "express";
import { register } from "../controllers/userContoller.js";

const router = Router();

// route to register a new user

router.post("/register", register);

export default router;