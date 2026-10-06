// Reports and moderation. Everything a person can type here is bounded.
export const REPORT_REASONS = Object.freeze({
    spam: "Spam or advertising",
    harassment: "Harassment or bullying",
    hate: "Hate or abuse",
    misinformation: "Misleading or false",
    copyright: "Copyright",
    other: "Something else",
});
export const REASON_NAMES = Object.freeze(Object.keys(REPORT_REASONS));

export const TARGET_TYPES = Object.freeze(["post", "comment", "user"]);

export const MAX_DETAILS_LENGTH = 500;
// the note a moderator writes for the author of what was removed (or for the record, when suspending)
export const MAX_NOTE_LENGTH = 500;
// reports one person can file in any rolling hour; the per-IP limiter sits in front of this
export const MAX_REPORTS_PER_HOUR = 10;

// how a report ends
export const REPORT_STATUS = Object.freeze({ OPEN: "open", DISMISSED: "dismissed", ACTIONED: "actioned" });
export const RESOLVED_STATUSES = Object.freeze([REPORT_STATUS.DISMISSED, REPORT_STATUS.ACTIONED]);

// what a moderator may do about each kind of target
export const ACTIONS_FOR = Object.freeze({
    comment: ["dismiss", "remove"],
    post: ["dismiss", "unpublish"],
    user: ["dismiss", "suspend"],
});
