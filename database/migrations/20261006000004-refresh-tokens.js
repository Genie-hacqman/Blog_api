import { DataTypes } from "sequelize";

// One row per issued refresh token. Rows sharing a familyId are one login session; rotating
// a token revokes the old row and adds a new one to the same family.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.createTable("refresh_tokens", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        userId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: "Users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
        familyId: { type: DataTypes.CHAR(36), allowNull: false },
        expiresAt: { type: DataTypes.DATE, allowNull: false },
        revokedAt: { type: DataTypes.DATE, allowNull: true },
        replacedById: { type: DataTypes.INTEGER, allowNull: true },
        ip: { type: DataTypes.STRING(45), allowNull: true },
        userAgent: { type: DataTypes.STRING(255), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex("refresh_tokens", ["userId"], { name: "idx_refresh_tokens_user" });
    await queryInterface.addIndex("refresh_tokens", ["familyId", "revokedAt"], { name: "idx_refresh_tokens_family" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("refresh_tokens");
};
