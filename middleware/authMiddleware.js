import jwt from "jsonwebtoken";
import { isTokenRevoked } from "../utils/tokenStore.js";

export const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Bearer token is required" });
    }

    const token = authHeader.slice(7);

    if (isTokenRevoked(token)) {
        return res.status(401).json({ error: "Token has been revoked" });
    }

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        req.token = token;
        next();
    } catch (error) {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
};
