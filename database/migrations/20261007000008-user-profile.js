import { DataTypes } from "sequelize";

// Public profile fields, the avatar link, and the soft-delete marker for account deletion.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.addColumn("Users", "bio", { type: DataTypes.STRING(500), allowNull: true });
    await queryInterface.addColumn("Users", "socialLinks", { type: DataTypes.JSON, allowNull: true });
    await queryInterface.addColumn("Users", "avatarMediaId", { type: DataTypes.INTEGER, allowNull: true });
    await queryInterface.addColumn("Users", "deletedAt", { type: DataTypes.DATE, allowNull: true });

    await queryInterface.addConstraint("Users", {
        type: "foreign key",
        name: "fk_users_avatar",
        fields: ["avatarMediaId"],
        references: { table: "media", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.removeConstraint("Users", "fk_users_avatar");
    for (const column of ["deletedAt", "avatarMediaId", "socialLinks", "bio"]) {
        await queryInterface.removeColumn("Users", column);
    }
};
