import { env } from "../config/env.js";
import { ForbiddenError } from "../utils/AppError.js";

// Guards the endpoints that act on the refresh-token cookie (refresh, logout).
// A custom header cannot be sent cross-site without a CORS preflight, which only our own
// origins pass; the Origin check is a second layer for browsers that send it.
export const cookieGuard = (req, res, next) => {
    if (req.get("x-requested-with") !== "fetch") {
        return next(new ForbiddenError("Missing X-Requested-With header"));
    }
    const origin = req.get("origin");
    if (origin && !env.CLIENT_ORIGINS.includes(origin)) {
        return next(new ForbiddenError("Origin not allowed"));
    }
    next();
};
