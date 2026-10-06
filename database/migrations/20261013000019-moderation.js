import { DataTypes } from "sequelize";
import { addColumnIfMissing, addIndexIfMissing, hasColumn, tableExists } from "../migrationHelpers.js";

const reference = (table, onDelete) => ({
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: table, key: "id" },
    onDelete,
    onUpdate: "CASCADE",
});

// Reports from readers, the note a moderator leaves for an author, and why an account was suspended.
// Exactly one of postId / commentId / targetUserId is set on a report, and it matches targetType: that is kept
// by the service, not by a CHECK, because MySQL refuses a CHECK on columns whose foreign keys cascade.
// Resumable: the table, columns and indexes are only created if missing.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "reports"))) {
        await queryInterface.createTable("reports", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            // users are never hard-deleted, so RESTRICT is a safety net
            reporterId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onDelete: "RESTRICT",
                onUpdate: "CASCADE",
            },
            targetType: { type: DataTypes.STRING(10), allowNull: false },
            // a report goes with the story or comment it is about
            postId: reference("Posts", "CASCADE"),
            commentId: reference("comments", "CASCADE"),
            targetUserId: reference("Users", "RESTRICT"),
            // "comment:12": one report per person per target is enforced on (reporterId, targetKey)
            targetKey: { type: DataTypes.STRING(40), allowNull: false },
            reason: { type: DataTypes.STRING(20), allowNull: false },
            details: { type: DataTypes.STRING(500), allowNull: true },
            status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "open" },
            handledBy: reference("Users", "SET NULL"),
            handledAt: { type: DataTypes.DATE, allowNull: true },
            resolutionNote: { type: DataTypes.STRING(500), allowNull: true },
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    await addIndexIfMissing(queryInterface, "reports", ["reporterId", "targetKey"], { name: "uq_reports_reporter_target", unique: true });
    // the queue: open reports grouped by target
    await addIndexIfMissing(queryInterface, "reports", ["status", "targetKey", "id"], { name: "idx_reports_queue" });
    await addIndexIfMissing(queryInterface, "reports", ["targetKey", "status"], { name: "idx_reports_target" });
    // the foreign keys
    await addIndexIfMissing(queryInterface, "reports", ["postId"], { name: "idx_reports_post" });
    await addIndexIfMissing(queryInterface, "reports", ["commentId"], { name: "idx_reports_comment" });
    await addIndexIfMissing(queryInterface, "reports", ["targetUserId"], { name: "idx_reports_target_user" });
    await addIndexIfMissing(queryInterface, "reports", ["handledBy"], { name: "idx_reports_handled_by" });

    // what a moderator wrote for the author of something that was removed (shown in the notification)
    await addColumnIfMissing(queryInterface, "notifications", "note", { type: DataTypes.STRING(500), allowNull: true });

    await addColumnIfMissing(queryInterface, "Users", "suspendedAt", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "Users", "suspendedReason", { type: DataTypes.STRING(500), allowNull: true });
};

export const down = async ({ context: queryInterface }) => {
    if (await tableExists(queryInterface, "reports")) await queryInterface.dropTable("reports");
    for (const [table, column] of [["notifications", "note"], ["Users", "suspendedReason"], ["Users", "suspendedAt"]]) {
        if (await hasColumn(queryInterface, table, column)) await queryInterface.removeColumn(table, column);
    }
};
