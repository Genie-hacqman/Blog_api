import express from "express";
import { register, login, logout } from "../controllers/userContoller.js";
import { createUserSchema,loginUserSchema } from "../schemas/userSchemas.js";
import { validate } from "../middleware/userValidation.js"
import { authenticate } from "../middleware/authMiddleware.js";
import { loginRateLimiter, registerRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

// route to register a new user

router.post("/register", registerRateLimiter, validate(createUserSchema), register);


// route to login a user
router.post("/login", loginRateLimiter, validate(loginUserSchema), login);

// route to logout a user
router.post("/logout", authenticate, logout);

export default router;
