import {
    dismiss,
    getPreferences,
    getUnreadCount,
    listNotifications,
    markRead,
    setPreferences,
    unsubscribe,
} from "../services/notificationService.js";
import { requireValidId } from "../utils/ids.js";
import { parsePagination } from "../utils/pagination.js";
import { sendSuccess } from "../utils/response.js";
import { ValidationError } from "../utils/AppError.js";

export const getNotifications = async (req, res) => {
    const unreadOnly = ["1", "true"].includes(String(req.query.unread));
    const { notifications, pagination, unreadCount } = await listNotifications(req.user, { ...parsePagination(req.query), unreadOnly });
    return sendSuccess(res, 200, { notifications }, { pagination, unreadCount });
};

export const getCount = async (req, res) => sendSuccess(res, 200, await getUnreadCount(req.user));

export const postRead = async (req, res) => sendSuccess(res, 200, await markRead(req.user, req.body.all ? null : req.body.ids));

export const deleteNotification = async (req, res) => {
    await dismiss(req.user, requireValidId(req.params.id, "Notification"));
    return sendSuccess(res, 200);
};

export const getMyPreferences = async (req, res) => sendSuccess(res, 200, { preferences: await getPreferences(req.user) });

export const putMyPreferences = async (req, res) => sendSuccess(res, 200, { preferences: await setPreferences(req.user, req.body.preferences) });

// Public (the person clicking may not be signed in) and POST only, so a mail scanner that merely fetches the link
// cannot unsubscribe anyone. The token comes in the body (the web page) or the query (a mail client's "one-click" POST).
export const postUnsubscribe = async (req, res) => {
    const token = req.body?.token ?? req.query.token;
    if (typeof token !== "string" || token.length === 0 || token.length > 2000) throw new ValidationError("This unsubscribe link is not valid or has expired");
    return sendSuccess(res, 200, await unsubscribe(token));
};
