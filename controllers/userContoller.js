import {registerUser} from "../services/userService.js";
import { createUserSchema } from "../schemas/userSchemas.js";


// controller function to handle user registration
export const register = async (req, res) => {

    try {
        const createdUser = await registerUser(req.body);
        return res.status(201).json({ message: "User created successfully", user: createdUser });

    } catch (error) {

        return res.status(500).json({ error: error.message });
    }
};