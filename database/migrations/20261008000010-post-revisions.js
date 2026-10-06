import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../migrationHelpers.js";

// One row per saved version of a post, numbered per post. Deleting a post deletes its history.
// Resumable like the migration before it: the table is only created if missing, and the version-1
// seed only covers posts that have no revision yet.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "post_revisions"))) {
        await queryInterface.createTable("post_revisions", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            postId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: "Posts", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            version: { type: DataTypes.INTEGER, allowNull: false },
            title: { type: DataTypes.STRING(255), allowNull: false },
            excerpt: { type: DataTypes.STRING(320), allowNull: true },
            content: { type: DataTypes.TEXT("medium"), allowNull: false },
            createdBy: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: "Users", key: "id" },
                onDelete: "SET NULL",
                onUpdate: "CASCADE",
            },
            reason: { type: DataTypes.STRING(32), allowNull: false },
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    await addIndexIfMissing(queryInterface, "post_revisions", ["postId", "version"], { name: "uq_post_revisions_version", unique: true });

    // history starts now for posts that already exist
    await queryInterface.sequelize.query(
        "INSERT INTO `post_revisions` (postId, version, title, excerpt, content, createdBy, reason, createdAt) " +
            "SELECT p.id, 1, p.title, p.excerpt, p.content, p.userId, 'created', p.createdAt FROM `Posts` p " +
            "WHERE NOT EXISTS (SELECT 1 FROM `post_revisions` r WHERE r.postId = p.id)",
    );
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("post_revisions");
};
