import { fn, literal, Op } from "sequelize";
import { Notification } from "../database/models/index.js";

export const createNotification = async (data) => Notification.create(data);

export const findNotificationByKey = async (dedupeKey) => Notification.findOne({ where: { dedupeKey } });

export const findNotificationById = async (id) => Notification.findByPk(id);

// one person's inbox, newest first (id breaks ties so paging is stable); only the ones meant for the inbox
export const findInboxPage = async ({ recipientId, unreadOnly, limit, offset }) => {
    const where = { recipientId, inApp: true, ...(unreadOnly && { readAt: null }) };
    const [rows, count] = await Promise.all([
        Notification.findAll({ where, order: [["createdAt", "DESC"], ["id", "DESC"]], limit, offset }),
        Notification.count({ where }),
    ]);
    return { rows, count };
};

export const countUnread = async (recipientId) => Notification.count({ where: { recipientId, inApp: true, readAt: null } });

// Mark the caller's own notifications read: the given ids, or all of them. Others' ids are simply not matched.
export const markRead = async (recipientId, ids) => {
    const [count] = await Notification.update(
        { readAt: new Date() },
        { where: { recipientId, inApp: true, readAt: null, ...(ids && { id: ids }) } },
    );
    return count;
};

export const destroyOwnNotification = async (id, recipientId) => Notification.destroy({ where: { id, recipientId } });

// Claim the right to email this notification: only one caller can win, so a retry or a second worker cannot send it twice.
export const claimEmail = async (id) => {
    const [count] = await Notification.update({ emailedAt: new Date() }, { where: { id, emailedAt: null } });
    return count === 1;
};

// the email could not be sent after all: give the claim back so the retry can send it
export const releaseEmail = async (id) => {
    await Notification.update({ emailedAt: null }, { where: { id } });
};

export const countEmailedSince = async (recipientId, since) => Notification.count({ where: { recipientId, emailedAt: { [Op.gte]: since } } });

// For stories that were sent back more than once: the newest rejection notification of each, Map(postId -> id).
// Only that one may show the editor's reason, which belongs to the latest decision.
export const findLatestRejectionIds = async (recipientId, postIds) => {
    const latest = new Map();
    if (postIds.length === 0) return latest;
    const rows = await Notification.findAll({
        attributes: ["postId", [fn("MAX", literal("`id`")), "id"]],
        where: { recipientId, type: "post_rejected", postId: postIds },
        group: ["postId"],
        raw: true,
    });
    for (const row of rows) latest.set(row.postId, Number(row.id));
    return latest;
};

// account deletion: the person's inbox goes
export const deleteNotificationsOfUser = async (userId, options = {}) => Notification.destroy({ where: { recipientId: userId }, ...options });
