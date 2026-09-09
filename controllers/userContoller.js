import {registerUser} from "../services/userService.js";
import { createUserSchema } from "../schemas/userSchemas.js";


// controller function to handle user registration
export const register = async (req, res) => {

    // validate the request body
    const {error} = createUserSchema.parse(req.body);
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }

    try {
        const createdUser = await registerUser(req.body);
        return res.status(201).json(createdUser);
        
    } catch (error) {

        return res.status(500).json({ error: error.message });
    }
};