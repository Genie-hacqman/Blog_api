// Reading analytics: what is counted, for how long, and the limits that keep it small and honest.
// Nothing here identifies a person (see services/analyticsService.js and utils/visitor.js).

// the ranges the screens offer, in days
export const ANALYTICS_RANGES = Object.freeze([7, 30, 90]);
export const DEFAULT_RANGE = 30;

// a visitor who comes back to the same story within this long is the same view, not a new one
export const VIEW_WINDOW_MS = 30 * 60 * 1000;

// different referring sites kept per story per day; the rest are counted together as "(other)"
export const MAX_REFERRERS_PER_POST_DAY = 50;
export const MAX_HOST_LENGTH = 100;

// "visitor" rows (a one-way hash that changes daily) are kept this many days, then deleted
export const VISITOR_RETENTION_DAYS = 2;

// A visit counts as a "read" when the reader got far enough down AND stayed long enough for it to be plausible:
// at least READ_MIN_DEPTH percent of the way down, and at least READ_TIME_FRACTION of the story's reading time,
// but never more than READ_TIME_CAP_SECONDS and never less than READ_TIME_FLOOR_SECONDS.
export const READ_MIN_DEPTH = 75;
export const READ_TIME_FRACTION = 0.4;
export const READ_TIME_CAP_SECONDS = 60;
export const READ_TIME_FLOOR_SECONDS = 10;
export const MAX_READ_SECONDS = 3600;

// how many rows the "top" lists show
export const TOP_LIMIT = 10;

// clients that announce themselves as robots, previewers or tools are not readers
export const BOT_PATTERN = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|embedly|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|httpclient|go-http-client/i;

export const INTERNAL_LABEL = "(internal)";
export const DIRECT_LABEL = "(direct)";
export const OTHER_LABEL = "(other)";
