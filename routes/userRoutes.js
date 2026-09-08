import express from "express";
import { register } from "../controllers/userContoller.js";

const registerRouter = express.Router();

// route to register a new user
registerRouter.post('/register', (req, res) => {
	res.status(200).json({
		success: true,
		message: "Register route is working"
	})
})

export default registerRouter;