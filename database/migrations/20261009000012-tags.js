import { DataTypes } from "sequelize";
import { addIndexIfMissing, tableExists } from "../migrationHelpers.js";

// Tags are free-form topics. A tag is identified by its slug (case-, space- and accent-insensitive);
// `name` is the spelling shown to readers. post_tags links posts to tags: the composite primary key makes it
// impossible for a post to carry the same tag twice.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "tags"))) {
        await queryInterface.createTable("tags", {
            id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
            name: { type: DataTypes.STRING(40), allowNull: false },
            slug: { type: DataTypes.STRING(50), allowNull: false, unique: true },
            createdAt: { type: DataTypes.DATE, allowNull: false },
            updatedAt: { type: DataTypes.DATE, allowNull: false },
        });
    }

    if (!(await tableExists(queryInterface, "post_tags"))) {
        await queryInterface.createTable("post_tags", {
            postId: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "Posts", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            tagId: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "tags", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    // "posts with this tag"
    await addIndexIfMissing(queryInterface, "post_tags", ["tagId", "postId"], { name: "idx_post_tags_tag" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("post_tags");
    await queryInterface.dropTable("tags");
};
