import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../migrationHelpers.js";

// Comments on posts, one level of replies (parentId points at a top-level comment). A deleted comment
// keeps its row (body wiped, deletedAt set) so the replies under it still read as a thread.
// Resumable: the table and each index are only created if missing.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "comments"))) {
        await queryInterface.createTable("comments", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            postId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "Posts", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            // users are never hard-deleted (their posts and comments point at them), so RESTRICT is a safety net
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "Users", key: "id" },
                onDelete: "RESTRICT",
                onUpdate: "CASCADE",
            },
            parentId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "comments", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            body: { type: DataTypes.STRING(2000), allowNull: true },
            editedAt: { type: DataTypes.DATE, allowNull: true },
            deletedAt: { type: DataTypes.DATE, allowNull: true },
            createdAt: { type: DataTypes.DATE, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    // top-level listing and counting for one post
    await addIndexIfMissing(queryInterface, "comments", ["postId", "parentId", "createdAt", "id"], { name: "idx_comments_post_parent_created" });
    // the replies of one comment
    await addIndexIfMissing(queryInterface, "comments", ["parentId", "createdAt", "id"], { name: "idx_comments_parent_created" });
    // a person's recent comments (the hourly quota) and the wipe when an account is deleted
    await addIndexIfMissing(queryInterface, "comments", ["userId", "createdAt"], { name: "idx_comments_user_created" });
};

export const down = async ({ context: queryInterface }) => {
    if (await tableExists(queryInterface, "comments")) await queryInterface.dropTable("comments");
};
