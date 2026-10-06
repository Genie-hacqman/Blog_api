import { QueryTypes } from "sequelize";
import sequelize from "../database/dbconnection.js";

// All the reading-analytics SQL. Counters are changed with single statements (x = x + n), never read-modify-write,
// so beacons arriving at the same moment cannot lose each other's counts. Every value is a bound parameter.

const select = (sql, replacements, options = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, ...options });
const affected = async (sql, replacements, options = {}) => (await sequelize.query(sql, { replacements, ...options }))[0].affectedRows;

// ---------- collecting ----------

// true when this visitor had not been seen on this story today (a repeat is ignored by the primary key)
export const insertVisitor = async ({ postId, day, visitorHash, at }, options = {}) =>
    (await affected("INSERT IGNORE INTO `post_visitors` (postId, day, visitorHash, lastViewAt) VALUES (:postId, :day, :visitorHash, :at)", { postId, day, visitorHash, at }, options)) === 1;

// true when a returning visitor's last view is older than the window, which makes this a new view
export const renewVisitor = async ({ postId, day, visitorHash, at, cutoff }, options = {}) =>
    (await affected(
        "UPDATE `post_visitors` SET lastViewAt = :at WHERE postId = :postId AND day = :day AND visitorHash = :visitorHash AND lastViewAt <= :cutoff",
        { postId, day, visitorHash, at, cutoff },
        options,
    )) > 0;

// true the first time a visitor reports their reading, so the figures are added once
export const markTimingReported = async ({ postId, day, visitorHash }, options = {}) =>
    (await affected(
        "UPDATE `post_visitors` SET timingReported = 1 WHERE postId = :postId AND day = :day AND visitorHash = :visitorHash AND timingReported = 0",
        { postId, day, visitorHash },
        options,
    )) > 0;

export const addToDaily = async ({ postId, day, views = 0, uniques = 0, readCount = 0, timed = 0, readSeconds = 0 }, options = {}) => {
    await sequelize.query(
        "INSERT INTO `post_daily_stats` (postId, day, views, uniques, readCount, timed, readSeconds) VALUES (:postId, :day, :views, :uniques, :readCount, :timed, :readSeconds) " +
            "ON DUPLICATE KEY UPDATE views = views + :views, uniques = uniques + :uniques, readCount = readCount + :readCount, timed = timed + :timed, readSeconds = readSeconds + :readSeconds",
        { replacements: { postId, day, views, uniques, readCount, timed, readSeconds }, ...options },
    );
};

export const referrerHostsOf = async (postId, day, options = {}) =>
    new Set((await select("SELECT host FROM `post_referrers_daily` WHERE postId = :postId AND day = :day", { postId, day }, options)).map((row) => row.host));

export const addReferrerView = async ({ postId, day, host }, options = {}) => {
    await sequelize.query(
        "INSERT INTO `post_referrers_daily` (postId, day, host, views) VALUES (:postId, :day, :host, 1) ON DUPLICATE KEY UPDATE views = views + 1",
        { replacements: { postId, day, host }, ...options },
    );
};

// the daily purge: visitor codes older than the retention are deleted (the totals stay)
export const purgeVisitorsBefore = async (day) => affected("DELETE FROM `post_visitors` WHERE day < :day", { day });

// ---------- reading ----------

const SERIES_COLUMNS =
    "DATE_FORMAT(s.day, '%Y-%m-%d') AS day, SUM(s.views) AS views, SUM(s.uniques) AS visitors, SUM(s.readCount) AS `reads`, SUM(s.timed) AS timed, SUM(s.readSeconds) AS readSeconds";

// the totals per day, for one story, one author's stories, or the whole site; only days that have any data
export const seriesForPost = (postId, from, to) =>
    select(`SELECT ${SERIES_COLUMNS} FROM post_daily_stats s WHERE s.postId = :postId AND s.day BETWEEN :from AND :to GROUP BY s.day ORDER BY s.day`, { postId, from, to });

export const seriesForAuthor = (userId, from, to) =>
    select(
        `SELECT ${SERIES_COLUMNS} FROM post_daily_stats s JOIN \`Posts\` p ON p.id = s.postId WHERE p.userId = :userId AND s.day BETWEEN :from AND :to GROUP BY s.day ORDER BY s.day`,
        { userId, from, to },
    );

export const seriesForSite = (from, to) =>
    select(`SELECT ${SERIES_COLUMNS} FROM post_daily_stats s WHERE s.day BETWEEN :from AND :to GROUP BY s.day ORDER BY s.day`, { from, to });

const STORY_COLUMNS =
    "p.id, p.title, p.slug, COALESCE(SUM(s.views), 0) AS views, COALESCE(SUM(s.uniques), 0) AS visitors, COALESCE(SUM(s.readCount), 0) AS `reads`, COALESCE(SUM(s.timed), 0) AS timed, COALESCE(SUM(s.readSeconds), 0) AS readSeconds";

// an author's published stories with their figures for the range (a story nobody read still appears, with zeros)
export const storiesOfAuthor = (userId, from, to, limit) =>
    select(
        `SELECT ${STORY_COLUMNS} FROM \`Posts\` p LEFT JOIN post_daily_stats s ON s.postId = p.id AND s.day BETWEEN :from AND :to ` +
            "WHERE p.userId = :userId AND p.status = 'published' GROUP BY p.id, p.title, p.slug ORDER BY views DESC, p.publishedAt DESC, p.id DESC LIMIT :limit",
        { userId, from, to, limit },
    );

// the stories most read on the whole site in the range
export const topStories = (from, to, limit) =>
    select(
        `SELECT ${STORY_COLUMNS} FROM post_daily_stats s JOIN \`Posts\` p ON p.id = s.postId WHERE s.day BETWEEN :from AND :to ` +
            "GROUP BY p.id, p.title, p.slug ORDER BY views DESC, p.id DESC LIMIT :limit",
        { from, to, limit },
    );

export const topAuthors = (from, to, limit) =>
    select(
        "SELECT u.id, u.username, SUM(s.views) AS views, SUM(s.uniques) AS visitors, SUM(s.readCount) AS `reads` FROM post_daily_stats s " +
            "JOIN `Posts` p ON p.id = s.postId JOIN `Users` u ON u.id = p.userId WHERE s.day BETWEEN :from AND :to AND u.status = 'active' " +
            "GROUP BY u.id, u.username ORDER BY views DESC, u.id DESC LIMIT :limit",
        { from, to, limit },
    );

// where readers came from, for one story, one author's stories, or everything
export const topSourcesForPost = (postId, from, to, limit) =>
    select("SELECT host, SUM(views) AS views FROM post_referrers_daily WHERE postId = :postId AND day BETWEEN :from AND :to GROUP BY host ORDER BY views DESC, host LIMIT :limit", { postId, from, to, limit });

export const topSourcesForAuthor = (userId, from, to, limit) =>
    select(
        "SELECT r.host, SUM(r.views) AS views FROM post_referrers_daily r JOIN `Posts` p ON p.id = r.postId WHERE p.userId = :userId AND r.day BETWEEN :from AND :to GROUP BY r.host ORDER BY views DESC, r.host LIMIT :limit",
        { userId, from, to, limit },
    );

export const topSourcesForSite = (from, to, limit) =>
    select("SELECT host, SUM(views) AS views FROM post_referrers_daily WHERE day BETWEEN :from AND :to GROUP BY host ORDER BY views DESC, host LIMIT :limit", { from, to, limit });

// growth, per UTC day: new accounts, new comments, and first publications
const perDay = (table, column, extra = "") =>
    (from, to) =>
        select(
            `SELECT DATE_FORMAT(${column}, '%Y-%m-%d') AS day, COUNT(*) AS n FROM \`${table}\` WHERE ${column} >= :from AND ${column} < DATE_ADD(:to, INTERVAL 1 DAY) ${extra} GROUP BY day ORDER BY day`,
            { from, to },
        );

export const signupsPerDay = perDay("Users", "createdAt");
export const commentsPerDay = perDay("comments", "createdAt", "AND deletedAt IS NULL");
export const publishedPerDay = perDay("Posts", "publishedAt");

// what readers did with an author's stories, all time (the reading figures above are for the range)
export const likesOnAuthor = async (userId) =>
    Number((await select("SELECT COUNT(*) AS n FROM `post_likes` l JOIN `Posts` p ON p.id = l.postId WHERE p.userId = :userId", { userId }))[0].n);

export const commentsOnAuthor = async (userId) =>
    Number((await select("SELECT COUNT(*) AS n FROM `comments` c JOIN `Posts` p ON p.id = c.postId WHERE p.userId = :userId AND c.deletedAt IS NULL", { userId }))[0].n);

export const bookmarksOnPost = async (postId) => Number((await select("SELECT COUNT(*) AS n FROM `bookmarks` WHERE postId = :postId", { postId }))[0].n);
