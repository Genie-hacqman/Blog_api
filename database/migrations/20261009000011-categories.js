import { DataTypes } from "sequelize";
import { tableExists } from "../migrationHelpers.js";

// Sections of the publication. A post has at most one (Posts.categoryId, added in a later
// migration). The slug is the public address (/category/<slug>) and never changes after creation.
const STARTER_CATEGORIES = [
    ["Technology", "technology", "Software, hardware, and the people who build them."],
    ["Culture", "culture", "Books, film, music, art, and the ideas around them."],
    ["Business", "business", "Companies, careers, money, and how work gets done."],
    ["Lifestyle", "lifestyle", "Food, travel, health, and everyday life."],
    ["Opinion", "opinion", "Arguments and points of view."],
];

// Resumable: the table is only created if missing, and a starter category is only inserted when no
// category with that slug or name exists, so a re-run never duplicates one.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "categories"))) {
        await queryInterface.createTable("categories", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            name: { type: DataTypes.STRING(60), allowNull: false, unique: true },
            slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
            description: { type: DataTypes.STRING(300), allowNull: true },
            createdAt: { type: DataTypes.DATE, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }

    for (const [name, slug, description] of STARTER_CATEGORIES) {
        await queryInterface.sequelize.query(
            "INSERT INTO `categories` (name, slug, description, createdAt, updatedAt) " +
                "SELECT :name, :slug, :description, NOW(), NOW() FROM DUAL " +
                "WHERE NOT EXISTS (SELECT 1 FROM `categories` WHERE slug = :slug OR name = :name)",
            { replacements: { name, slug, description } },
        );
    }
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("categories");
};
