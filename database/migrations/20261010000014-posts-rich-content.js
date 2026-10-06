import { DataTypes } from "sequelize";
import { addColumnIfMissing, addConstraintIfMissing, addIndexIfMissing, hasColumn, hasConstraint, hasIndex, tableExists } from "../migrationHelpers.js";

// The schema for rich posts: the plain text derived from a post's HTML (what search, excerpts and
// reading time work from), an optional cover image, and the list of inline images a post uses
// (so an image still in use is never deleted, and unused ones can be swept).
// Resumable: every step checks whether it is already done. The content itself is converted by the next migration.
export const up = async ({ context: queryInterface }) => {
    await addColumnIfMissing(queryInterface, "Posts", "contentText", { type: DataTypes.TEXT("medium"), allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "coverMediaId", { type: DataTypes.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "coverAlt", { type: DataTypes.STRING(200), allowNull: true });
    await addIndexIfMissing(queryInterface, "Posts", ["coverMediaId"], { name: "idx_posts_cover" });
    await addConstraintIfMissing(queryInterface, "Posts", {
        type: "foreign key",
        name: "fk_posts_cover",
        fields: ["coverMediaId"],
        references: { table: "media", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    });

    if (!(await tableExists(queryInterface, "post_media"))) {
        await queryInterface.createTable("post_media", {
            postId: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "Posts", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            mediaId: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                allowNull: false,
                references: { model: "media", key: "id" },
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            },
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    // "which posts use this image?"
    await addIndexIfMissing(queryInterface, "post_media", ["mediaId", "postId"], { name: "idx_post_media_media" });
};

export const down = async ({ context: queryInterface }) => {
    if (await tableExists(queryInterface, "post_media")) await queryInterface.dropTable("post_media");
    // the foreign key must go before the index it relies on
    if (await hasConstraint(queryInterface, "Posts", "fk_posts_cover")) await queryInterface.removeConstraint("Posts", "fk_posts_cover");
    if (await hasIndex(queryInterface, "Posts", "idx_posts_cover")) await queryInterface.removeIndex("Posts", "idx_posts_cover");
    for (const column of ["coverAlt", "coverMediaId", "contentText"]) {
        if (await hasColumn(queryInterface, "Posts", column)) await queryInterface.removeColumn("Posts", column);
    }
};
