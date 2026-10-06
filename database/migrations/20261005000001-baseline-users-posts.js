import { DataTypes } from "sequelize";

const tableNames = async (queryInterface) =>
    (await queryInterface.showAllTables()).map((table) => (typeof table === "string" ? table : table.tableName));

// Captures the schema that Model.sync() used to create, so a fresh database can be built
// from migrations alone. Databases that already have these tables (everything created
// before migrations existed) are left untouched.
export const up = async ({ context: queryInterface }) => {
    const existing = await tableNames(queryInterface);

    if (!existing.includes("Users")) {
        await queryInterface.createTable("Users", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            firstName: { type: DataTypes.STRING, allowNull: false },
            lastName: { type: DataTypes.STRING, allowNull: false },
            username: { type: DataTypes.STRING, allowNull: false, unique: true },
            email: { type: DataTypes.STRING, allowNull: false, unique: true },
            password: { type: DataTypes.STRING, allowNull: false },
            createdAt: { type: DataTypes.DATE, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }

    if (!existing.includes("Posts")) {
        await queryInterface.createTable("Posts", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            title: { type: DataTypes.STRING, allowNull: false },
            content: { type: DataTypes.TEXT, allowNull: false },
            userId: { type: DataTypes.INTEGER, allowNull: false },
            status: { type: DataTypes.ENUM("draft", "published"), allowNull: false, defaultValue: "draft" },
            createdAt: { type: DataTypes.DATE, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
};

// dropping these would delete every user and post, so the baseline is deliberately one-way
export const down = async () => {
    throw new Error("The baseline migration is not reversible: it would drop the Users and Posts tables.");
};
