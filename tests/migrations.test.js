import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { migrator } from "../database/migrator.js";
import { resetDatabase, closeDatabase } from "./helpers.js";

const foreignKeyExists = async () => {
    const [rows] = await sequelize.query(
        `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Posts' AND CONSTRAINT_NAME = 'fk_posts_user'`,
    );
    return rows.length > 0;
};

const tableNames = async () =>
    (await sequelize.getQueryInterface().showAllTables()).map((table) => (typeof table === "string" ? table : table.tableName));

describe("migrations", () => {
    before(resetDatabase);
    after(closeDatabase);

    it("leaves no migration pending after resetDatabase", async () => {
        assert.deepEqual(await migrator.pending(), []);
    });

    it("reverts and re-applies migrations 3 to 20, backfilling users and posts that predate them", async () => {
        await migrator.down({ step: 18 });

        const tables = await tableNames();
        for (const table of ["refresh_tokens", "user_tokens", "audit_logs", "media", "post_revisions", "categories", "tags", "post_tags", "post_media", "comments", "post_likes", "bookmarks", "follows", "notifications", "notification_preferences", "reports", "post_daily_stats", "post_visitors", "post_referrers_daily"]) {
            assert.ok(!tables.includes(table), `${table} should be gone after reverting`);
        }
        const columns = await sequelize.getQueryInterface().describeTable("Users");
        assert.equal(columns.role, undefined);
        assert.equal(columns.avatarMediaId, undefined);
        assert.equal((await sequelize.getQueryInterface().describeTable("Posts")).slug, undefined);

        // an account created before roles and verification existed
        await sequelize.query(
            "INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) " +
                "VALUES ('Old','Timer','oldtimer','old@example.com','$2a$10$abcdefghijklmnopqrstuv','2024-01-02 03:04:05','2024-01-02 03:04:05')",
        );

        // posts from before lifecycle and revisions existed: two share a title, one was only a draft
        const insertPost = (title, status, createdAt) =>
            sequelize.query(
                "INSERT INTO `Posts` (title, content, userId, status, createdAt, updatedAt) " +
                    "VALUES (:title, 'Some body text for the post.', (SELECT id FROM `Users` WHERE username = 'oldtimer'), :status, :createdAt, :createdAt)",
                { replacements: { title, status, createdAt } },
            );
        await insertPost("Hello, World!", "published", "2024-02-03 04:05:06");
        await insertPost("Hello, World!", "published", "2024-02-04 04:05:06");
        await insertPost("Café Müller", "draft", "2024-02-05 04:05:06");

        await migrator.up();

        const [legacyPosts] = await sequelize.query("SELECT id, slug, status, publishedAt, createdAt, excerpt, readingTime FROM `Posts` ORDER BY id");
        assert.equal(legacyPosts[0].slug, "hello-world");
        assert.equal(legacyPosts[1].slug, `hello-world-${legacyPosts[1].id}`, "a duplicate title gets a unique slug");
        assert.equal(legacyPosts[2].slug, "cafe-muller", "accents are folded");
        assert.equal(new Date(legacyPosts[0].publishedAt).getTime(), new Date(legacyPosts[0].createdAt).getTime(), "published posts keep their creation time as publication time");
        assert.equal(legacyPosts[2].publishedAt, null, "drafts are not published");
        assert.equal(legacyPosts[0].excerpt, "Some body text for the post.");
        assert.equal(legacyPosts[0].readingTime, 1);
        const [[converted]] = await sequelize.query("SELECT content, contentText FROM `Posts` WHERE id = :id", { replacements: { id: legacyPosts[0].id } });
        assert.deepEqual(converted, { content: "<p>Some body text for the post.</p>", contentText: "Some body text for the post." }, "plain-text posts become HTML");
        const [revisions] = await sequelize.query("SELECT postId, version, reason FROM `post_revisions` ORDER BY postId");
        assert.equal(revisions.length, 3, "every existing post starts with a version 1");
        assert.ok(revisions.every((revision) => revision.version === 1 && revision.reason === "created"));

        const [[row]] = await sequelize.query("SELECT role, status, emailVerifiedAt, failedLoginCount FROM `Users` WHERE username = 'oldtimer'");
        assert.equal(row.role, "author", "existing users keep the ability to write");
        assert.equal(row.status, "active");
        assert.ok(row.emailVerifiedAt, "existing users are grandfathered as verified");
        assert.equal(row.failedLoginCount, 0);
        assert.ok((await tableNames()).includes("audit_logs"));
        assert.ok((await tableNames()).includes("media"));
        const [[profile]] = await sequelize.query("SELECT bio, socialLinks, avatarMediaId, deletedAt FROM `Users` WHERE username = 'oldtimer'");
        assert.deepEqual(profile, { bio: null, socialLinks: null, avatarMediaId: null, deletedAt: null });
    });

    it("finishes migrations 9 and 10 after an interrupted run, and running them again changes nothing", async () => {
        // MySQL cannot roll back schema changes, so a migration that dies half way (here: after adding
        // its columns but before the backfill and indexes) leaves the table half changed. A migration
        // that is not resumable then fails forever with "Duplicate column name".
        await migrator.down({ step: 12 });
        await sequelize.transaction(async (transaction) => {
            await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction });
            await sequelize.query("TRUNCATE TABLE `Posts`", { transaction });
            await sequelize.query("TRUNCATE TABLE `Users`", { transaction });
            await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction });
        });
        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('A', 'B', 'author1', 'a@example.com', 'x', NOW(), NOW())");
        const insertPost = (title, content, status, createdAt) =>
            sequelize.query(
                "INSERT INTO `Posts` (title, content, userId, status, createdAt, updatedAt) VALUES (:title, :content, 1, :status, :createdAt, :createdAt)",
                { replacements: { title, content, status, createdAt } },
            );
        // longer than the excerpt column: the case that broke the first attempt
        await insertPost("A Very Long Story", "A long story. ".repeat(400), "published", "2024-02-03 04:05:06");
        await insertPost("Hello, World!", "short", "published", "2024-02-04 04:05:06");
        await insertPost("Hello, World!", "short again", "draft", "2024-02-05 04:05:06");

        await sequelize.query("ALTER TABLE `Posts` MODIFY status ENUM('draft','pending_review','scheduled','published','rejected','archived','private') NOT NULL DEFAULT 'draft'");
        for (const column of ["slug VARCHAR(160) NULL", "excerpt VARCHAR(320) NULL", "readingTime INT NOT NULL DEFAULT 1", "publishedAt DATETIME NULL", "scheduledAt DATETIME NULL", "reviewedBy INT NULL", "reviewedAt DATETIME NULL", "rejectionReason VARCHAR(500) NULL"]) {
            await sequelize.query(`ALTER TABLE \`Posts\` ADD COLUMN ${column}`);
        }

        await migrator.up();

        const [posts] = await sequelize.query("SELECT id, slug, CHAR_LENGTH(excerpt) AS excerptLength, publishedAt FROM `Posts` ORDER BY id");
        assert.deepEqual(posts.map((post) => post.slug), ["a-very-long-story", "hello-world", `hello-world-${posts[2].id}`]);
        assert.equal(posts[0].excerptLength, 320, "the excerpt, ellipsis included, fits its column");
        assert.ok(posts[0].publishedAt);
        assert.equal(posts[2].publishedAt, null);
        for (const name of ["uq_posts_slug", "idx_posts_status_published", "idx_posts_user_status_updated", "idx_posts_status_scheduled"]) {
            const indexes = await sequelize.getQueryInterface().showIndex("Posts");
            assert.ok(indexes.some((index) => index.name === name), `${name} should exist`);
        }
        const [constraints] = await sequelize.query(
            "SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Posts' AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
        );
        assert.deepEqual(constraints.map((constraint) => constraint.name).sort(), ["fk_posts_category", "fk_posts_cover", "fk_posts_reviewer", "fk_posts_user"]);
        const [[{ revisions }]] = await sequelize.query("SELECT COUNT(*) AS revisions FROM `post_revisions`");
        assert.equal(Number(revisions), 3, "each post has exactly one first revision");

        // the app has since edited a post; running the migrations again must not undo that or duplicate history
        await sequelize.query("UPDATE `Posts` SET slug = 'chosen-by-the-author', publishedAt = '2030-01-01 00:00:00' WHERE id = :id", { replacements: { id: posts[1].id } });
        const context = { context: sequelize.getQueryInterface() };
        await (await import("../database/migrations/20261008000009-posts-lifecycle.js")).up(context);
        await (await import("../database/migrations/20261008000010-post-revisions.js")).up(context);

        const [[edited]] = await sequelize.query("SELECT slug, YEAR(publishedAt) AS year FROM `Posts` WHERE id = :id", { replacements: { id: posts[1].id } });
        assert.deepEqual(edited, { slug: "chosen-by-the-author", year: 2030 });
        const [[{ after }]] = await sequelize.query("SELECT COUNT(*) AS after FROM `post_revisions`");
        assert.equal(Number(after), 3);
    });

    it("finishes migrations 11 to 20 after an interrupted run, and running them again changes nothing", async () => {
        await migrator.down({ step: 10 });
        // an interruption part way: the categories table and one starter row exist, and Posts already has its new column
        await sequelize.query(
            "CREATE TABLE `categories` (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL UNIQUE, slug VARCHAR(80) NOT NULL UNIQUE, " +
                "description VARCHAR(300) NULL, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL)",
        );
        await sequelize.query("INSERT INTO `categories` (name, slug, createdAt, updatedAt) VALUES ('Technology', 'technology', NOW(), NOW())");
        await sequelize.query("ALTER TABLE `Posts` ADD COLUMN categoryId INT NULL");

        await migrator.up();

        const names = async (table) => (await sequelize.getQueryInterface().showIndex(table)).map((index) => index.name);
        for (const name of ["ft_posts_title", "ft_posts_text", "idx_posts_category_status_published"]) {
            assert.ok((await names("Posts")).includes(name), `${name} should exist`);
        }
        assert.ok(!(await names("Posts")).includes("ft_posts_body"), "search moved to the plain-text column");
        assert.ok((await names("post_tags")).includes("idx_post_tags_tag"));
        assert.ok((await names("post_media")).includes("idx_post_media_media"));
        const [constraints] = await sequelize.query(
            "SELECT CONSTRAINT_NAME AS name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'Posts' AND CONSTRAINT_TYPE = 'FOREIGN KEY'",
        );
        assert.ok(constraints.map((constraint) => constraint.name).includes("fk_posts_category"));
        const [categories] = await sequelize.query("SELECT slug FROM `categories` ORDER BY id");
        assert.deepEqual(categories.map((category) => category.slug), ["technology", "culture", "business", "lifestyle", "opinion"], "the missing starter categories are added, none duplicated");

        // an editor has renamed one; re-running must not add it back or overwrite the edit
        await sequelize.query("UPDATE `categories` SET name = 'Tech' WHERE slug = 'technology'");
        const context = { context: sequelize.getQueryInterface() };
        for (const file of [
            "20261009000011-categories.js",
            "20261009000012-tags.js",
            "20261009000013-posts-taxonomy-search.js",
            "20261010000014-posts-rich-content.js",
            "20261010000015-posts-rich-content-backfill.js",
            "20261011000016-comments.js",
            "20261011000017-reactions-and-follows.js",
            "20261012000018-notifications.js",
            "20261013000019-moderation.js",
            "20261014000020-analytics.js",
        ]) {
            await (await import(`../database/migrations/${file}`)).up(context);
        }
        const [after] = await sequelize.query("SELECT name FROM `categories` ORDER BY id");
        assert.equal(after.length, 5);
        assert.equal(after[0].name, "Tech");
    });

    it("converts plain-text posts and their revisions to HTML, restores the text on the way down, and resumes after an interruption", async () => {
        await migrator.down({ step: 7 });
        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('R', 'W', 'richwriter', 'rich@example.com', 'x', NOW(), NOW())");
        const legacy = "First <b>para</b> & more\n\nSecond line one\nSecond line two\n\nThird";
        const insertPost = async (title, slug, content) => {
            await sequelize.query(
                "INSERT INTO `Posts` (title, content, userId, status, slug, createdAt, updatedAt) VALUES (:title, :content, (SELECT id FROM `Users` WHERE username = 'richwriter'), 'draft', :slug, NOW(), NOW())",
                { replacements: { title, slug, content } },
            );
            return (await sequelize.query("SELECT id FROM `Posts` WHERE slug = :slug", { replacements: { slug }, type: "SELECT" }))[0].id;
        };
        const first = await insertPost("Legacy one", "legacy-one", legacy);
        const empty = await insertPost("Legacy empty", "legacy-empty", "");
        await sequelize.query("INSERT INTO `post_revisions` (postId, version, title, content, reason, createdAt) VALUES (:id, 1, 'Legacy one', :legacy, 'created', NOW()), (:id, 2, 'Legacy one', 'old <i>x</i>', 'edited', NOW())", {
            replacements: { id: first, legacy },
        });
        const select = async (sql, replacements) => (await sequelize.query(sql, { replacements, type: "SELECT" }));

        await migrator.up();

        const [row] = await select("SELECT content, contentText FROM `Posts` WHERE id = :id", { id: first });
        assert.equal(row.content, "<p>First &lt;b&gt;para&lt;/b&gt; &amp; more</p><p>Second line one<br>Second line two</p><p>Third</p>", "text is escaped, paragraphs and line breaks are kept");
        assert.equal(row.contentText, "First <b>para</b> & more Second line one Second line two Third");
        const [blank] = await select("SELECT content, contentText FROM `Posts` WHERE id = :id", { id: empty });
        assert.deepEqual(blank, { content: "", contentText: "" }, "an empty body is converted too (and so is not picked up again)");
        const revisions = await select("SELECT version, content FROM `post_revisions` WHERE postId = :id ORDER BY version", { id: first });
        assert.equal(revisions[0].content, row.content, "revisions are converted so the history still compares");
        assert.equal(revisions[1].content, "<p>old &lt;i&gt;x&lt;/i&gt;</p>");
        const indexes = (await sequelize.getQueryInterface().showIndex("Posts")).map((index) => index.name);
        assert.ok(indexes.includes("ft_posts_text") && !indexes.includes("ft_posts_body"));

        // interrupted run: a post that was never converted next to converted ones; running again converts only that one
        const late = await insertPost("Late", "late-post", "Late post");
        const context = { context: sequelize.getQueryInterface() };
        await (await import("../database/migrations/20261010000015-posts-rich-content-backfill.js")).up(context);
        assert.equal((await select("SELECT content FROM `Posts` WHERE id = :id", { id: late }))[0].content, "<p>Late post</p>");
        assert.equal((await select("SELECT content FROM `Posts` WHERE id = :id", { id: first }))[0].content, row.content, "a converted post is not converted twice");

        await migrator.down({ step: 7 });
        assert.equal((await select("SELECT content FROM `Posts` WHERE id = :id", { id: first }))[0].content, "First <b>para</b> & more\n\nSecond line one\nSecond line two\n\nThird");
        assert.equal((await select("SELECT content FROM `post_revisions` WHERE postId = :id AND version = 2", { id: first }))[0].content, "old <i>x</i>");
        assert.ok((await sequelize.getQueryInterface().showIndex("Posts")).some((index) => index.name === "ft_posts_body"));

        await migrator.up();
        assert.equal((await select("SELECT content FROM `Posts` WHERE id = :id", { id: first }))[0].content, row.content, "up again converts again");
    });

    it("creates the comment, like, bookmark and follow tables, finishes after an interruption, and refuses a self-follow", async () => {
        await migrator.down({ step: 5 });
        const gone = await tableNames();
        for (const table of ["comments", "post_likes", "bookmarks", "follows"]) assert.ok(!gone.includes(table), `${table} should be gone`);

        // an interruption: the first table and half of the second exist, nothing else
        await migrator.up({ to: "20261011000016-comments.js" });
        await sequelize.query("CREATE TABLE `post_likes` (postId INT NOT NULL, userId INT NOT NULL, createdAt DATETIME NOT NULL, PRIMARY KEY (postId, userId))");
        await migrator.up();

        const tables = await tableNames();
        for (const table of ["comments", "post_likes", "bookmarks", "follows"]) assert.ok(tables.includes(table), `${table} should exist`);
        const indexes = async (table) => (await sequelize.getQueryInterface().showIndex(table)).map((index) => index.name);
        assert.ok((await indexes("post_likes")).includes("idx_post_likes_user_created"), "the half-made table is completed");
        assert.ok((await indexes("comments")).includes("idx_comments_post_parent_created"));
        assert.ok((await indexes("follows")).includes("idx_follows_following_created"));

        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('F', 'W', 'follower1', 'f1@example.com', 'x', NOW(), NOW())");
        const [[{ id }]] = await sequelize.query("SELECT id FROM `Users` WHERE username = 'follower1'");
        await assert.rejects(() => sequelize.query("INSERT INTO `follows` (followerId, followingId, createdAt) VALUES (:id, :id, NOW())", { replacements: { id } }));

        // running them again changes nothing
        const context = { context: sequelize.getQueryInterface() };
        await (await import("../database/migrations/20261011000016-comments.js")).up(context);
        await (await import("../database/migrations/20261011000017-reactions-and-follows.js")).up(context);
    });

    it("creates the notification tables, finishes after an interruption, and keeps one row per dedupe key", async () => {
        await migrator.down({ step: 3 });
        assert.ok(!(await tableNames()).includes("notifications"));

        // an interruption: the inbox table exists, its preferences table does not
        await migrator.up();
        await sequelize.query("DROP TABLE `notification_preferences`");
        await (await import("../database/migrations/20261012000018-notifications.js")).up({ context: sequelize.getQueryInterface() });

        const tables = await tableNames();
        assert.ok(tables.includes("notifications") && tables.includes("notification_preferences"));
        const indexes = (await sequelize.getQueryInterface().showIndex("notifications")).map((index) => index.name);
        for (const name of ["uq_notifications_dedupe", "idx_notifications_recipient_created", "idx_notifications_recipient_unread"]) {
            assert.ok(indexes.includes(name), `${name} should exist`);
        }

        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('N', 'O', 'notified1', 'n1@example.com', 'x', NOW(), NOW())");
        const [[{ id }]] = await sequelize.query("SELECT id FROM `Users` WHERE username = 'notified1'");
        const insert = () =>
            sequelize.query("INSERT INTO `notifications` (recipientId, type, dedupeKey, createdAt) VALUES (:id, 'new_follower', 'follow:1:2:1', NOW())", { replacements: { id } });
        await insert();
        await assert.rejects(insert, "the same dedupe key cannot be recorded twice");
    });

    it("creates the reports table and the moderation columns, finishes after an interruption, and allows one report per person per target", async () => {
        await migrator.down({ step: 2 });
        const columns = async (table) => Object.keys(await sequelize.getQueryInterface().describeTable(table));
        assert.ok(!(await tableNames()).includes("reports"));
        assert.ok(!(await columns("notifications")).includes("note"));
        assert.ok(!(await columns("Users")).includes("suspendedAt"));

        // an interruption: the new Users column exists but nothing else does
        await sequelize.query("ALTER TABLE `Users` ADD COLUMN suspendedAt DATETIME NULL");
        await migrator.up();

        assert.ok((await tableNames()).includes("reports"));
        for (const [table, column] of [["notifications", "note"], ["Users", "suspendedAt"], ["Users", "suspendedReason"]]) {
            assert.ok((await columns(table)).includes(column), `${table}.${column} should exist`);
        }
        const indexes = (await sequelize.getQueryInterface().showIndex("reports")).map((index) => index.name);
        for (const name of ["uq_reports_reporter_target", "idx_reports_queue", "idx_reports_target"]) assert.ok(indexes.includes(name), name);

        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('R', 'P', 'reporter1', 'rp1@example.com', 'x', NOW(), NOW())");
        const [[{ id }]] = await sequelize.query("SELECT id FROM `Users` WHERE username = 'reporter1'");
        const insert = () =>
            sequelize.query("INSERT INTO `reports` (reporterId, targetType, targetUserId, targetKey, reason, createdAt) VALUES (:id, 'user', :id, 'user:99', 'spam', NOW())", { replacements: { id } });
        await insert();
        await assert.rejects(insert, "a second report of the same target by the same person is refused");
        const [[{ status }]] = await sequelize.query("SELECT status FROM `reports` WHERE reporterId = :id", { replacements: { id } });
        assert.equal(status, "open");
    });

    it("creates the analytics tables, finishes after an interruption, and removes the daily visitor codes with the story", async () => {
        await migrator.down({ step: 1 });
        const gone = await tableNames();
        for (const table of ["post_daily_stats", "post_visitors", "post_referrers_daily"]) assert.ok(!gone.includes(table), `${table} should be gone`);

        // an interruption: one table and one index exist, the rest do not
        await sequelize.query("CREATE TABLE `post_visitors` (postId INT NOT NULL, day DATE NOT NULL, visitorHash CHAR(32) NOT NULL, lastViewAt DATETIME NOT NULL, timingReported TINYINT(1) NOT NULL DEFAULT 0, PRIMARY KEY (postId, day, visitorHash), CONSTRAINT fk_visitors_post FOREIGN KEY (postId) REFERENCES `Posts` (id) ON DELETE CASCADE)");
        await migrator.up();

        const tables = await tableNames();
        for (const table of ["post_daily_stats", "post_visitors", "post_referrers_daily"]) assert.ok(tables.includes(table), `${table} should exist`);
        const indexes = async (table) => (await sequelize.getQueryInterface().showIndex(table)).map((index) => index.name);
        assert.ok((await indexes("post_visitors")).includes("idx_post_visitors_day"), "the half-made table is completed");
        assert.ok((await indexes("post_daily_stats")).includes("idx_post_daily_stats_day"));
        assert.ok((await indexes("Users")).includes("idx_users_created"));
        assert.ok((await indexes("comments")).includes("idx_comments_created"));

        await sequelize.query("INSERT INTO `Users` (firstName, lastName, username, email, password, createdAt, updatedAt) VALUES ('A', 'N', 'analyst1', 'an1@example.com', 'x', NOW(), NOW())");
        const [[{ id: userId }]] = await sequelize.query("SELECT id FROM `Users` WHERE username = 'analyst1'");
        await sequelize.query("INSERT INTO `Posts` (title, content, userId, status, slug, createdAt, updatedAt) VALUES ('T', '<p>x</p>', :userId, 'published', 'analytics-story', NOW(), NOW())", { replacements: { userId } });
        const [[{ id: postId }]] = await sequelize.query("SELECT id FROM `Posts` WHERE slug = 'analytics-story'");
        await sequelize.query("INSERT INTO `post_daily_stats` (postId, day, views) VALUES (:postId, '2026-01-01', 2)", { replacements: { postId } });
        await assert.rejects(() => sequelize.query("INSERT INTO `post_daily_stats` (postId, day, views) VALUES (:postId, '2026-01-01', 1)", { replacements: { postId } }), "one row per story per day");
        await sequelize.query("INSERT INTO `post_visitors` (postId, day, visitorHash, lastViewAt) VALUES (:postId, '2026-01-01', 'abcdefabcdefabcdefabcdefabcdefab', NOW())", { replacements: { postId } });
        await sequelize.query("DELETE FROM `Posts` WHERE id = :postId", { replacements: { postId } });
        for (const table of ["post_daily_stats", "post_visitors"]) {
            const [[{ n }]] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
            assert.equal(Number(n), 0, `${table} goes with the story`);
        }
    });

    it("refuses to revert the baseline, which would drop all data", async () => {
        await assert.rejects(() => migrator.down({ to: 0 }), /not reversible/);
        assert.equal(await foreignKeyExists(), false, "later migrations were reverted before the baseline refused");
        await migrator.up();
        assert.equal(await foreignKeyExists(), true);
    });
});
