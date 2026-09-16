import { registerUser, loginUser } from "../services/userService.js";
import { createUserSchema } from "../schemas/userSchemas.js";
import { revokeToken } from "../utils/tokenStore.js";

// controller function to handle user registration
export const register = async (req, res) => {

    try {
        const createdUser = await registerUser(req.body);
        return res.status(201).json({ message: "User created successfully", user: createdUser });

    } catch (error) {

        return res.status(500).json({ error: error.message });
    }
};

// controller for handling user login
export const login = async (req, res) => {
    try{
        // call the service to authenticate the user
        const {user, token} = await loginUser(req.body);
        return res.status(200).json({ message: "User logged in successfully", user, token });

    } catch (error) {
        if (error.message === "Invalid email or password") {
            return res.status(401).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message });

    }
};



// controller for handling user logout
export const logout = async (req, res) => {
    try {
        revokeToken(req.token);
        return res.status(200).json({ message: "User logged out successfully" });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
