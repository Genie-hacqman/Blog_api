import { env } from "../config/env.js";
import {
    ANALYTICS_RANGES,
    DEFAULT_RANGE,
    MAX_REFERRERS_PER_POST_DAY,
    OTHER_LABEL,
    READ_MIN_DEPTH,
    READ_TIME_CAP_SECONDS,
    READ_TIME_FLOOR_SECONDS,
    READ_TIME_FRACTION,
    TOP_LIMIT,
    VIEW_WINDOW_MS,
    VISITOR_RETENTION_DAYS,
} from "../config/analytics.js";
import { roleHasPermission } from "../config/roles.js";
import {
    addReferrerView,
    addToDaily,
    bookmarksOnPost,
    commentsOnAuthor,
    commentsPerDay,
    insertVisitor,
    likesOnAuthor,
    markTimingReported,
    publishedPerDay,
    purgeVisitorsBefore,
    referrerHostsOf,
    renewVisitor,
    seriesForAuthor,
    seriesForPost,
    seriesForSite,
    signupsPerDay,
    storiesOfAuthor,
    topAuthors,
    topSourcesForAuthor,
    topSourcesForPost,
    topSourcesForSite,
    topStories,
} from "../repositories/analyticsRepository.js";
import { countCommentsForPosts } from "../repositories/commentRepository.js";
import { countLikes } from "../repositories/likeRepository.js";
import { findPostsByIds } from "../repositories/postRepository.js";
import { withTransaction } from "../database/transaction.js";
import { addDays, daysBetween, now, utcDay } from "../utils/clock.js";
import { looksLikeBot, referrerHost, visitorHash } from "../utils/visitor.js";
import { NotFoundError, ValidationError } from "../utils/AppError.js";

// ---------------------------------------------------------------------------------------------
// Collecting. Nothing here stores an address, a browser string or an account: a visitor is a one-way hash that
// changes every day (utils/visitor.js), kept two days. Counting never fails a page: the controller answers first.
// ---------------------------------------------------------------------------------------------

// jobs still in flight, so a test can wait for the counts to land
const pending = new Set();
export const trackAnalytics = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
    return promise;
};
export const whenAnalyticsIdle = async () => {
    while (pending.size > 0) await Promise.allSettled(pending);
};

const countableStory = async (postId, viewer) => {
    const [post] = await findPostsByIds([postId]);
    // only published stories, and never the author's own visits
    if (!post || post.status !== "published" || viewer?.id === post.userId) return null;
    return post;
};

// A reader opened a published story. Returns whether it was counted (the caller never tells the browser).
// dnt: the visitor sent Do Not Track or Global Privacy Control: still a view, but no code is made for them.
export const recordView = async ({ postId, referrer, viewer = null, ip, userAgent, dnt = false }) => {
    if (!env.ANALYTICS_ENABLED || looksLikeBot(userAgent)) return false;
    const post = await countableStory(postId, viewer);
    if (!post) return false;

    const at = now();
    const day = utcDay(at);
    const host = referrerHost(referrer);

    return withTransaction(async (transaction) => {
        let counted = true;
        let unique = false;
        if (!dnt) {
            const code = visitorHash(ip, userAgent, day);
            if (await insertVisitor({ postId, day, visitorHash: code, at }, { transaction })) {
                unique = true;
            } else {
                // seen before today: a new view only if the last one was long enough ago
                counted = await renewVisitor({ postId, day, visitorHash: code, at, cutoff: new Date(at.getTime() - VIEW_WINDOW_MS) }, { transaction });
            }
        }
        if (!counted) return false;

        await addToDaily({ postId, day, views: 1, uniques: unique ? 1 : 0 }, { transaction });
        // a flood of made-up referring sites cannot grow the table: past the cap they are counted together
        const known = await referrerHostsOf(postId, day, { transaction });
        await addReferrerView({ postId, day, host: known.has(host) || known.size < MAX_REFERRERS_PER_POST_DAY ? host : OTHER_LABEL }, { transaction });
        return true;
    });
};

// how many seconds a reader must have stayed for it to count as a read of this story
export const readThresholdSeconds = (readingTimeMinutes) =>
    Math.min(READ_TIME_CAP_SECONDS, Math.max(READ_TIME_FLOOR_SECONDS, Math.round(READ_TIME_FRACTION * (readingTimeMinutes ?? 1) * 60)));

// The reader left: how long they stayed and how far down they got. Added once per visitor per day.
export const recordReading = async ({ postId, seconds, depth, viewer = null, ip, userAgent, dnt = false }) => {
    if (!env.ANALYTICS_ENABLED || dnt || looksLikeBot(userAgent)) return false;
    const post = await countableStory(postId, viewer);
    if (!post) return false;

    const day = utcDay();
    const qualifies = depth >= READ_MIN_DEPTH && seconds >= readThresholdSeconds(post.readingTime);

    return withTransaction(async (transaction) => {
        if (!(await markTimingReported({ postId, day, visitorHash: visitorHash(ip, userAgent, day) }, { transaction }))) return false;
        await addToDaily({ postId, day, timed: 1, readSeconds: Math.round(seconds), readCount: qualifies ? 1 : 0 }, { transaction });
        return true;
    });
};

// the daily clean-up: visitor codes older than the retention go, the totals stay
export const purgeVisitors = () => purgeVisitorsBefore(addDays(utcDay(), -(VISITOR_RETENTION_DAYS - 1)));

// ---------------------------------------------------------------------------------------------
// Reading the numbers
// ---------------------------------------------------------------------------------------------

export const parseRange = (value) => {
    const days = value === undefined ? DEFAULT_RANGE : Number(value);
    if (!ANALYTICS_RANGES.includes(days)) throw new ValidationError(`days must be one of: ${ANALYTICS_RANGES.join(", ")}`);
    return days;
};

const rangeOf = (days) => {
    const to = utcDay();
    return { days, from: addDays(to, -(days - 1)), to };
};

const n = (value) => Number(value ?? 0);

// one row per day of the range, zeros where nothing happened, so a screen never has to guess
const fill = (range, rows, columns) => {
    const byDay = new Map(rows.map((row) => [row.day, row]));
    return daysBetween(range.from, range.to).map((day) => ({
        day,
        ...Object.fromEntries(columns.map((column) => [column, n(byDay.get(day)?.[column])])),
    }));
};

const totalsOf = (rows) => {
    const sum = (column) => rows.reduce((total, row) => total + n(row[column]), 0);
    const visitors = sum("visitors");
    const timed = sum("timed");
    const reads = sum("reads");
    return {
        views: sum("views"),
        visitors,
        reads,
        // the mean of the times that readers reported (null when no one did)
        avgReadSeconds: timed > 0 ? Math.round(sum("readSeconds") / timed) : null,
        // of the visitors counted, how many read it (null when there were none)
        readRate: visitors > 0 ? Math.min(1, Math.round((reads / visitors) * 1000) / 1000) : null,
    };
};

const toStory = (row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    views: n(row.views),
    visitors: n(row.visitors),
    reads: n(row.reads),
    avgReadSeconds: n(row.timed) > 0 ? Math.round(n(row.readSeconds) / n(row.timed)) : null,
});

const toSources = (rows) => rows.map((row) => ({ host: row.host, views: n(row.views) }));

const READING_COLUMNS = ["views", "visitors", "reads"];

// an author's own numbers: totals, a zero-filled daily series, their stories ranked, where readers came from
export const getMySummary = async (user, days) => {
    const range = rangeOf(days);
    const [rows, stories, sources, likes, comments] = await Promise.all([
        seriesForAuthor(user.id, range.from, range.to),
        storiesOfAuthor(user.id, range.from, range.to, 50),
        topSourcesForAuthor(user.id, range.from, range.to, TOP_LIMIT),
        likesOnAuthor(user.id),
        commentsOnAuthor(user.id),
    ]);
    return {
        range,
        totals: totalsOf(rows),
        series: fill(range, rows, READING_COLUMNS),
        stories: stories.map(toStory),
        sources: toSources(sources),
        reactions: { likes, comments },
    };
};

// one story's numbers. Owner or admin only; anyone else is told it does not exist.
export const getPostAnalytics = async (user, postId, days) => {
    const [post] = await findPostsByIds([postId]);
    if (!post || (post.userId !== user.id && !roleHasPermission(user.role, "analytics:read_all"))) {
        throw new NotFoundError("Story not found");
    }
    const range = rangeOf(days);
    const [rows, sources, likes, comments, bookmarks] = await Promise.all([
        seriesForPost(postId, range.from, range.to),
        topSourcesForPost(postId, range.from, range.to, TOP_LIMIT),
        countLikes(postId),
        countCommentsForPosts([postId]),
        bookmarksOnPost(postId),
    ]);
    return {
        post: { id: post.id, title: post.title, slug: post.slug, status: post.status },
        range,
        totals: totalsOf(rows),
        series: fill(range, rows, READING_COLUMNS),
        sources: toSources(sources),
        reactions: { likes, comments: comments.get(postId) ?? 0, bookmarks },
    };
};

// the whole site, for admins: reading, growth, and what leads
export const getSiteAnalytics = async (days) => {
    const range = rangeOf(days);
    const [rows, signups, comments, published, stories, authors, sources] = await Promise.all([
        seriesForSite(range.from, range.to),
        signupsPerDay(range.from, range.to),
        commentsPerDay(range.from, range.to),
        publishedPerDay(range.from, range.to),
        topStories(range.from, range.to, TOP_LIMIT),
        topAuthors(range.from, range.to, TOP_LIMIT),
        topSourcesForSite(range.from, range.to, TOP_LIMIT),
    ]);
    const growth = (perDay) => new Map(perDay.map((row) => [row.day, n(row.n)]));
    const [signupsBy, commentsBy, publishedBy] = [growth(signups), growth(comments), growth(published)];
    const series = fill(range, rows, READING_COLUMNS).map((day) => ({
        ...day,
        signups: signupsBy.get(day.day) ?? 0,
        comments: commentsBy.get(day.day) ?? 0,
        published: publishedBy.get(day.day) ?? 0,
    }));
    const sumOf = (column) => series.reduce((total, day) => total + day[column], 0);
    return {
        range,
        totals: { ...totalsOf(rows), signups: sumOf("signups"), comments: sumOf("comments"), published: sumOf("published") },
        series,
        stories: stories.map(toStory),
        authors: authors.map((row) => ({ id: row.id, username: row.username, views: n(row.views), visitors: n(row.visitors), reads: n(row.reads) })),
        sources: toSources(sources),
    };
};
