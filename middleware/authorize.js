import { env } from "../config/env.js";
import { roleHasPermission } from "../config/roles.js";
import { AppError, ForbiddenError } from "../utils/AppError.js";

// Coarse permission check; must run after authenticate. Resource-level rules
// (e.g. "is this your post?") live in policies/ and are applied by the services.
export const requirePermission = (permission) => (req, res, next) => {
    if (!roleHasPermission(req.user.role, permission)) {
        return next(new ForbiddenError());
    }
    next();
};

// writing needs a confirmed mailbox, unless REQUIRE_VERIFIED_EMAIL is turned off
export const requireVerifiedEmail = (req, res, next) => {
    if (env.REQUIRE_VERIFIED_EMAIL && !req.user.emailVerified) {
        return next(new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address to do that"));
    }
    next();
};
