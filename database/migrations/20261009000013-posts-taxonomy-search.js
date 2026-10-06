import { DataTypes } from "sequelize";
import { addColumnIfMissing, addConstraintIfMissing, addIndexIfMissing, hasColumn, hasConstraint, hasIndex } from "../migrationHelpers.js";

// A post's one category, and the full-text indexes behind search. Two FULLTEXT indexes, not one,
// so a match in the title can be scored higher than a match in the body.
// Resumable: every step checks whether it is already done.
export const up = async ({ context: queryInterface }) => {
    await addColumnIfMissing(queryInterface, "Posts", "categoryId", { type: DataTypes.INTEGER, allowNull: true });
    // browse a section: published posts of one category, newest first (also serves the foreign key)
    await addIndexIfMissing(queryInterface, "Posts", ["categoryId", "status", "publishedAt"], { name: "idx_posts_category_status_published" });
    await addConstraintIfMissing(queryInterface, "Posts", {
        type: "foreign key",
        name: "fk_posts_category",
        fields: ["categoryId"],
        references: { table: "categories", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    });
    await addIndexIfMissing(queryInterface, "Posts", ["title"], { name: "ft_posts_title", type: "FULLTEXT" });
    await addIndexIfMissing(queryInterface, "Posts", ["excerpt", "content"], { name: "ft_posts_body", type: "FULLTEXT" });
};

export const down = async ({ context: queryInterface }) => {
    for (const name of ["ft_posts_body", "ft_posts_title"]) {
        if (await hasIndex(queryInterface, "Posts", name)) await queryInterface.removeIndex("Posts", name);
    }
    // the foreign key must go before the index it relies on
    if (await hasConstraint(queryInterface, "Posts", "fk_posts_category")) await queryInterface.removeConstraint("Posts", "fk_posts_category");
    if (await hasIndex(queryInterface, "Posts", "idx_posts_category_status_published")) {
        await queryInterface.removeIndex("Posts", "idx_posts_category_status_published");
    }
    if (await hasColumn(queryInterface, "Posts", "categoryId")) await queryInterface.removeColumn("Posts", "categoryId");
};
