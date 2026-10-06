import { DataTypes } from "sequelize";

// Posts.userId was never a real foreign key, the listing query had no supporting index,
// and TEXT (64 KB) is too small for long posts once multi-byte characters are involved.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.changeColumn("Posts", "content", {
        type: DataTypes.TEXT("medium"),
        allowNull: false,
    });

    // fails (and leaves nothing half-applied) if any post points at a user that no longer exists
    await queryInterface.addConstraint("Posts", {
        type: "foreign key",
        name: "fk_posts_user",
        fields: ["userId"],
        references: { table: "Users", field: "id" },
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    });

    // public listing: WHERE status = 'published' ORDER BY createdAt DESC
    await queryInterface.addIndex("Posts", ["status", "createdAt"], { name: "idx_posts_status_created" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.removeIndex("Posts", "idx_posts_status_created");
    await queryInterface.removeConstraint("Posts", "fk_posts_user");
    // intentionally left as MEDIUMTEXT: shrinking back to TEXT could truncate existing posts
};
