import express from "express";
import { register } from "../controllers/userContoller.js";
import { createUserSchema,loginUserSchema } from "../schemas/userSchemas.js";
import { validate } from "../middleware/userValidation.js";

const router = express.Router();

// route to register a new user

router.post("/register", validate(createUserSchema), register);

export default router;
