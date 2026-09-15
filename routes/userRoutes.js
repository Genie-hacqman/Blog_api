import express from "express";
import { register, login, logout } from "../controllers/userContoller.js";
import { createUserSchema,loginUserSchema } from "../schemas/userSchemas.js";
import { validate } from "../middleware/userValidation.js"

const router = express.Router();

// route to register a new user

router.post("/register", validate(createUserSchema), register);


// route to login a user
router.post("/login", validate(loginUserSchema), login);

// route to logout a user
router.post("/logout", logout);

export default router;
