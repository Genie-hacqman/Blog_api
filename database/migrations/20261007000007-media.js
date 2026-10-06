import { DataTypes } from "sequelize";

// One row per stored image. `key` is the object-storage path; the URL is derived from it
// by the storage provider, so moving buckets or domains never touches this table.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.createTable("media", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        ownerId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: { model: "Users", key: "id" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
        },
        key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
        mime: { type: DataTypes.STRING(50), allowNull: false },
        size: { type: DataTypes.INTEGER, allowNull: false },
        width: { type: DataTypes.INTEGER, allowNull: false },
        height: { type: DataTypes.INTEGER, allowNull: false },
        purpose: { type: DataTypes.ENUM("avatar", "cover", "inline"), allowNull: false },
        deletedAt: { type: DataTypes.DATE, allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    // daily upload quota: count a user's recent uploads
    await queryInterface.addIndex("media", ["ownerId", "createdAt"], { name: "idx_media_owner_created" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("media");
};
