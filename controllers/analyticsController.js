import logger from "../config/logger.js";
import {
    getMySummary,
    getPostAnalytics,
    getSiteAnalytics,
    parseRange,
    recordReading,
    recordView,
    trackAnalytics,
} from "../services/analyticsService.js";
import { requireValidId } from "../utils/ids.js";
import { sendSuccess } from "../utils/response.js";

// What the connection says about the visitor. It is turned into a one-way daily code and then forgotten.
const visitorOf = (req) => ({
    viewer: req.user ?? null,
    ip: req.ip,
    userAgent: req.get("user-agent") ?? "",
    // Do Not Track or Global Privacy Control
    dnt: req.get("dnt") === "1" || req.get("sec-gpc") === "1",
});

// The browser is told "got it" and nothing else, whatever happened to the message: the answer must not reveal
// whether it was counted. The counting happens after the response, and a failure is logged and dropped.
const accept = (res, work) => {
    res.status(204).end();
    trackAnalytics(work().catch((error) => logger.warn({ err: { message: error.message } }, "Could not record analytics")));
};

export const postView = (req, res) =>
    accept(res, () => recordView({ postId: req.body.postId, referrer: req.body.referrer, ...visitorOf(req) }));

export const postReading = (req, res) =>
    accept(res, () => recordReading({ postId: req.body.postId, seconds: req.body.seconds, depth: req.body.depth, ...visitorOf(req) }));

export const getMine = async (req, res) => sendSuccess(res, 200, { analytics: await getMySummary(req.user, parseRange(req.query.days)) });

export const getPost = async (req, res) =>
    sendSuccess(res, 200, { analytics: await getPostAnalytics(req.user, requireValidId(req.params.id, "Story"), parseRange(req.query.days)) });

export const getSite = async (req, res) => sendSuccess(res, 200, { analytics: await getSiteAnalytics(parseRange(req.query.days)) });
