// What the app notifies people about, and each kind's default channels. People can change these in Settings.
// `reviewers: true` kinds only ever go to people who can review stories (editors and admins).
export const NOTIFICATION_TYPES = Object.freeze({
    comment_on_post: { label: "Comments on your stories", inApp: true, email: true },
    comment_reply: { label: "Replies to your comments", inApp: true, email: true },
    new_follower: { label: "New followers", inApp: true, email: false },
    post_submitted: { label: "Stories waiting for review", inApp: true, email: false, reviewers: true },
    post_published: { label: "Your stories being published", inApp: true, email: true },
    post_rejected: { label: "Your stories being sent back", inApp: true, email: true },
    comment_removed: { label: "Your comments being removed", inApp: true, email: true },
    post_unpublished: { label: "Your stories being taken down", inApp: true, email: true },
});

export const TYPE_NAMES = Object.freeze(Object.keys(NOTIFICATION_TYPES));

// an editor-facing event goes to at most this many people
export const MAX_REVIEWER_FANOUT = 200;
// notification emails one person can receive per hour; beyond that they stay in the inbox only
export const MAX_EMAILS_PER_HOUR = 20;
// how much of a comment is shown in the inbox
export const EXCERPT_LENGTH = 140;
// an unsubscribe link in an old email should keep working
export const UNSUBSCRIBE_TTL_SECONDS = 2 * 365 * 24 * 60 * 60;
export const UNSUBSCRIBE_AUDIENCE = "blog-notification-unsubscribe";
