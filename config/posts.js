// Post lifecycle constants. The transition rules themselves live in policies/postWorkflow.js.
export const POST_STATUSES = ["draft", "pending_review", "scheduled", "published", "rejected", "archived", "private"];

export const MAX_TITLE_LENGTH = 255;
// the submitted body is HTML (markup included); the readable text inside it has its own, smaller limit
export const MAX_CONTENT_LENGTH = 200_000;
export const MAX_TEXT_LENGTH = 50_000;
export const MAX_IMAGES_PER_POST = 30;
export const MAX_NESTING_DEPTH = 12;
export const MAX_COVER_ALT_LENGTH = 200;
export const MAX_EXCERPT_LENGTH = 320;
export const MAX_REJECTION_REASON_LENGTH = 500;

export const WORDS_PER_MINUTE = 225;

// slugs are public URLs (/blog/<slug>)
export const MAX_SLUG_LENGTH = 100;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// a scheduled time must be at least this far ahead (so the job cannot miss it) and not absurdly far
export const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

// edits by the same person within this window update the latest revision instead of adding one
export const REVISION_COALESCE_MS = 10 * 60 * 1000;
export const MAX_REVISIONS_PER_POST = 100;
