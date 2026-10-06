// Limits for comments, follows and other social features. Everything a person can do here is bounded.
export const MAX_COMMENT_LENGTH = 2000;
// a person's comments in any rolling hour (replies included); the per-IP limiter sits in front of this
export const MAX_COMMENTS_PER_HOUR = 30;
// people one account can follow
export const MAX_FOLLOWING = 5000;
