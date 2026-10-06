import express from "express";
import {
    changePassword,
    forgotPassword,
    login,
    logout,
    logoutAll,
    me,
    refresh,
    register,
    resendVerification,
    resetPassword,
    verifyEmail,
} from "../controllers/authController.js";
import {
    changePasswordSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    verifyEmailSchema,
} from "../schemas/authSchemas.js";
import { createUserSchema, loginUserSchema } from "../schemas/userSchemas.js";
import { validate } from "../middleware/userValidation.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { cookieGuard } from "../middleware/cookieGuard.js";
import {
    changePasswordRateLimiter,
    forgotPasswordRateLimiter,
    loginRateLimiter,
    refreshRateLimiter,
    registerRateLimiter,
    resendVerificationRateLimiter,
    tokenRateLimiter,
} from "../middleware/rateLimiter.js";

const router = express.Router();

// registration and sign-in
router.post("/register", registerRateLimiter, validate(createUserSchema), register);
router.post("/login", loginRateLimiter, validate(loginUserSchema), login);

// session management: these two read the refresh-token cookie, so they are CSRF-guarded
router.post("/refresh", cookieGuard, refreshRateLimiter, refresh);
router.post("/logout", cookieGuard, logout);
router.post("/logout-all", authenticate, logoutAll);
router.get("/me", authenticate, me);

// email verification
router.post("/verify-email", tokenRateLimiter, validate(verifyEmailSchema), verifyEmail);
router.post("/resend-verification", authenticate, resendVerificationRateLimiter, resendVerification);

// passwords
router.post("/forgot-password", forgotPasswordRateLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", tokenRateLimiter, validate(resetPasswordSchema), resetPassword);
router.post("/change-password", authenticate, changePasswordRateLimiter, validate(changePasswordSchema), changePassword);

export default router;
