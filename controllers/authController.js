import {
    changePassword as changePasswordService,
    getCurrentUser,
    loginUser,
    logout as logoutService,
    logoutEverywhere,
    refreshSession,
    registerUser,
    requestPasswordReset,
    resendVerification as resendVerificationService,
    resetPassword as resetPasswordService,
    verifyEmail as verifyEmailService,
} from "../services/authService.js";
import { env } from "../config/env.js";
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_MS } from "../config/auth.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

// The refresh token only ever travels in this cookie: HttpOnly keeps it away from page scripts,
// and the narrow Path means the browser sends it to /api/auth/* and nowhere else.
const cookieOptions = {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: REFRESH_COOKIE_PATH,
};
const setRefreshCookie = (res, token) => res.cookie(REFRESH_COOKIE_NAME, token, { ...cookieOptions, maxAge: REFRESH_TOKEN_TTL_MS });
const clearRefreshCookie = (res) => res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);

export const register = async (req, res) => {
    const user = await registerUser(req.body, requestContext(req));
    return sendSuccess(res, 201, { user });
};

export const login = async (req, res) => {
    const { user, accessToken, refreshToken } = await loginUser(req.body, requestContext(req));
    setRefreshCookie(res, refreshToken);
    return sendSuccess(res, 200, { user, accessToken });
};

export const refresh = async (req, res) => {
    try {
        const { user, accessToken, refreshToken } = await refreshSession(req.cookies?.[REFRESH_COOKIE_NAME], requestContext(req));
        // null when this request lost a multi-tab race: the cookie was already replaced
        if (refreshToken) {
            setRefreshCookie(res, refreshToken);
        }
        return sendSuccess(res, 200, { user, accessToken });
    } catch (error) {
        // a dead session leaves a useless cookie behind; drop it
        if (error.status === 401) {
            clearRefreshCookie(res);
        }
        throw error;
    }
};

export const logout = async (req, res) => {
    await logoutService(req.cookies?.[REFRESH_COOKIE_NAME]);
    clearRefreshCookie(res);
    return sendSuccess(res, 200);
};

export const logoutAll = async (req, res) => {
    await logoutEverywhere(req.user.id, requestContext(req));
    clearRefreshCookie(res);
    return sendSuccess(res, 200);
};

export const me = async (req, res) => {
    const user = await getCurrentUser(req.user.id);
    return sendSuccess(res, 200, { user });
};

export const verifyEmail = async (req, res) => {
    await verifyEmailService(req.body.token, requestContext(req));
    return sendSuccess(res, 200);
};

export const resendVerification = async (req, res) => {
    await resendVerificationService(req.user.id);
    return sendSuccess(res, 200);
};

// the same answer whether or not the email belongs to an account
export const forgotPassword = async (req, res) => {
    await requestPasswordReset(req.body.email);
    return sendSuccess(res, 200, { message: "If that email has an account, a reset link is on its way." });
};

export const resetPassword = async (req, res) => {
    await resetPasswordService(req.body, requestContext(req));
    return sendSuccess(res, 200);
};

export const changePassword = async (req, res) => {
    await changePasswordService(req.user.id, req.sid, req.body, requestContext(req));
    return sendSuccess(res, 200);
};
