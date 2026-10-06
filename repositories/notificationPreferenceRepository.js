import { Op } from "sequelize";
import { NotificationPreference } from "../database/models/index.js";

export const findPreferencesOfUsers = async (userIds, type) =>
    userIds.length === 0 ? [] : NotificationPreference.findAll({ where: { userId: userIds, ...(type && { type }) } });

export const findPreferencesOfUser = async (userId) => NotificationPreference.findAll({ where: { userId } });

// items: [{ type, inApp, email }]; a row is created or updated per type
export const savePreferences = async (userId, items) => {
    await NotificationPreference.bulkCreate(
        items.map(({ type, inApp, email }) => ({ userId, type, inApp, email })),
        { updateOnDuplicate: ["inApp", "email", "updatedAt"] },
    );
};

export const deletePreferencesOfUser = async (userId, options = {}) => NotificationPreference.destroy({ where: { userId: { [Op.eq]: userId } }, ...options });
