import { DataTypes } from "sequelize";
import { addIndexIfMissing, hasConstraint, tableExists } from "../migrationHelpers.js";

const link = (table, key, action = "CASCADE") => ({
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
    references: { model: table, key },
    onDelete: action,
    onUpdate: action,
});

// Likes, bookmarks and follows: pure link tables. The composite primary key makes a duplicate impossible,
// so a double click or a race can never count twice. Resumable: tables, indexes and the CHECK are guarded.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "post_likes"))) {
        await queryInterface.createTable("post_likes", {
            postId: link("Posts", "id"),
            userId: link("Users", "id"),
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    await addIndexIfMissing(queryInterface, "post_likes", ["userId", "createdAt"], { name: "idx_post_likes_user_created" });

    if (!(await tableExists(queryInterface, "bookmarks"))) {
        await queryInterface.createTable("bookmarks", {
            userId: link("Users", "id"),
            postId: link("Posts", "id"),
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    // the "Saved" list: one person's bookmarks, newest first
    await addIndexIfMissing(queryInterface, "bookmarks", ["userId", "createdAt", "postId"], { name: "idx_bookmarks_user_created" });
    // "who saved this post" (cleanup when a post is deleted is by foreign key, this serves the key itself)
    await addIndexIfMissing(queryInterface, "bookmarks", ["postId"], { name: "idx_bookmarks_post" });

    if (!(await tableExists(queryInterface, "follows"))) {
        await queryInterface.createTable("follows", {
            // MySQL does not allow a CHECK on columns whose foreign key cascades. Users are never hard-deleted
            // (account deletion removes these rows explicitly), so RESTRICT is also the honest choice here.
            followerId: link("Users", "id", "RESTRICT"),
            followingId: link("Users", "id", "RESTRICT"),
            createdAt: { type: DataTypes.DATE, allowNull: false },
        });
    }
    // a person's followers, newest first
    await addIndexIfMissing(queryInterface, "follows", ["followingId", "createdAt", "followerId"], { name: "idx_follows_following_created" });
    // nobody follows themselves, whatever the application does
    if (!(await hasConstraint(queryInterface, "follows", "chk_follows_not_self"))) {
        await queryInterface.sequelize.query("ALTER TABLE `follows` ADD CONSTRAINT `chk_follows_not_self` CHECK (`followerId` <> `followingId`)");
    }
};

export const down = async ({ context: queryInterface }) => {
    for (const table of ["follows", "bookmarks", "post_likes"]) {
        if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
    }
};
