import { DataTypes } from "sequelize";

// Roles, account status, email verification and brute-force bookkeeping for Users.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.addColumn("Users", "role", {
        type: DataTypes.ENUM("user", "author", "editor", "admin"),
        allowNull: false,
        defaultValue: "user",
    });
    await queryInterface.addColumn("Users", "status", {
        type: DataTypes.ENUM("active", "suspended", "deleted"),
        allowNull: false,
        defaultValue: "active",
    });
    await queryInterface.addColumn("Users", "emailVerifiedAt", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn("Users", "lastLoginAt", { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addColumn("Users", "failedLoginCount", {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    });
    await queryInterface.addColumn("Users", "lockedUntil", { type: DataTypes.DATE, allowNull: true });

    // Everyone who exists before roles did could already write posts and was never asked to
    // verify an email, so they keep both abilities. New sign-ups start as "user", unverified.
    await queryInterface.sequelize.query("UPDATE `Users` SET `role` = 'author', `emailVerifiedAt` = `createdAt`");
};

export const down = async ({ context: queryInterface }) => {
    for (const column of ["lockedUntil", "failedLoginCount", "lastLoginAt", "emailVerifiedAt", "status", "role"]) {
        await queryInterface.removeColumn("Users", column);
    }
};
