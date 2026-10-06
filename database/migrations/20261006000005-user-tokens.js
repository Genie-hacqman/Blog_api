import { DataTypes } from "sequelize";

// Single-use tokens emailed to a user (verify email, reset password). Only the hash is stored.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.createTable("user_tokens", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: "Users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        purpose: { type: DataTypes.ENUM("verify_email", "reset_password"), allowNull: false },
        tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        usedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex("user_tokens", ["userId", "purpose"], { name: "idx_user_tokens_user_purpose" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("user_tokens");
};
