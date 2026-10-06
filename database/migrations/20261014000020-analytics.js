import { DataTypes } from "sequelize";
import { addIndexIfMissing, hasIndex, tableExists } from "../migrationHelpers.js";

const postKey = {
    type: DataTypes.INTEGER,
    primaryKey: true,
    allowNull: false,
    references: { model: "Posts", key: "id" },
    onDelete: "CASCADE",
    onUpdate: "CASCADE",
};

// Reading analytics, kept deliberately small and impersonal: daily totals per story, the sources readers came from,
// and a short-lived table that lets one visitor be told from another WITHIN a day. That table holds only a one-way hash
// that changes every day (never an address, a browser string or an account) and is emptied after two days.
// Resumable: tables and indexes are only created if missing.
export const up = async ({ context: queryInterface }) => {
    if (!(await tableExists(queryInterface, "post_daily_stats"))) {
        await queryInterface.createTable("post_daily_stats", {
            postId: postKey,
            day: { type: DataTypes.DATEONLY, primaryKey: true, allowNull: false },
            views: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
            uniques: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
            readCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
            // how many readers reported how long they stayed, and the total of those times
            timed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
            readSeconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        });
    }
    // site-wide ranges ("the last 30 days") read by day first
    await addIndexIfMissing(queryInterface, "post_daily_stats", ["day", "postId"], { name: "idx_post_daily_stats_day" });

    if (!(await tableExists(queryInterface, "post_visitors"))) {
        await queryInterface.createTable("post_visitors", {
            postId: postKey,
            day: { type: DataTypes.DATEONLY, primaryKey: true, allowNull: false },
            visitorHash: { type: DataTypes.CHAR(32), primaryKey: true, allowNull: false },
            lastViewAt: { type: DataTypes.DATE, allowNull: false },
            timingReported: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        });
    }
    // the daily purge
    await addIndexIfMissing(queryInterface, "post_visitors", ["day"], { name: "idx_post_visitors_day" });

    if (!(await tableExists(queryInterface, "post_referrers_daily"))) {
        await queryInterface.createTable("post_referrers_daily", {
            postId: postKey,
            day: { type: DataTypes.DATEONLY, primaryKey: true, allowNull: false },
            host: { type: DataTypes.STRING(100), primaryKey: true, allowNull: false },
            views: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
        });
    }
    await addIndexIfMissing(queryInterface, "post_referrers_daily", ["day", "host"], { name: "idx_post_referrers_day" });

    // the admin's growth series (new accounts, new comments per day) become range scans
    await addIndexIfMissing(queryInterface, "Users", ["createdAt"], { name: "idx_users_created" });
    await addIndexIfMissing(queryInterface, "comments", ["createdAt"], { name: "idx_comments_created" });
};

export const down = async ({ context: queryInterface }) => {
    for (const table of ["post_referrers_daily", "post_visitors", "post_daily_stats"]) {
        if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
    }
    if (await hasIndex(queryInterface, "Users", "idx_users_created")) await queryInterface.removeIndex("Users", "idx_users_created");
    if (await hasIndex(queryInterface, "comments", "idx_comments_created")) await queryInterface.removeIndex("comments", "idx_comments_created");
};
