import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../migrationHelpers.js";

// The inbox, and each person's choices about what reaches them. A notification stores ids, not text: titles
// and comment excerpts are read when the inbox is opened, so they are always current and always subject to the
// visibility rules. dedupeKey is UNIQUE: the same event recorded twice (a retried job) is one row.
// Resumable: tables and indexes are only created if missing.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "notifications"))) {
        await queryInterface.createTable("notifications", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            // users are never hard-deleted (account deletion removes their notifications itself), so RESTRICT is a safety net
            recipientId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onDelete: "RESTRICT",
                onUpdate: "CASCADE",
            },
            actorId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "Users", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },
            type: { type: DataTypes.STRING(40), allowNull: false },
            postId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "Posts", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            commentId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "comments", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            dedupeKey: { type: DataTypes.STRING(160), allowNull: false },
            // does it show in the inbox? A row also exists when someone wants the email but not the inbox entry
            inApp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
            readAt: { type: DataTypes.DATE, allowNull: true },
            emailedAt: { type: DataTypes.DATE, allowNull: true },
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    await addIndexIfMissing(queryInterface, "notifications", ["dedupeKey"], { name: "uq_notifications_dedupe", unique: true });
    // the inbox: one person's notifications, newest first
    await addIndexIfMissing(queryInterface, "notifications", ["recipientId", "inApp", "createdAt", "id"], { name: "idx_notifications_recipient_created" });
    // the unread badge
    await addIndexIfMissing(queryInterface, "notifications", ["recipientId", "inApp", "readAt"], { name: "idx_notifications_recipient_unread" });
    // the foreign keys to the thing it is about (cleanup when a post or comment goes)
    await addIndexIfMissing(queryInterface, "notifications", ["postId"], { name: "idx_notifications_post" });
    await addIndexIfMissing(queryInterface, "notifications", ["commentId"], { name: "idx_notifications_comment" });
    await addIndexIfMissing(queryInterface, "notifications", ["actorId"], { name: "idx_notifications_actor" });

    if (!(await tableExists(queryInterface, "notification_preferences"))) {
        await queryInterface.createTable("notification_preferences", {
            userId: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onDelete: "RESTRICT",
                onUpdate: "CASCADE",
            },
            type: { type: DataTypes.STRING(40), primaryKey: true, allowNull: false },
            inApp: { type: DataTypes.BOOLEAN, allowNull: false },
            email: { type: DataTypes.BOOLEAN, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
};

export const down = async ({ context: queryInterface }) => {
    for (const table of ["notification_preferences", "notifications"]) {
        if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
    }
};
