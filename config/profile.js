export const BIO_MAX_LENGTH = 500;

// usernames become part of public URLs (/u/<username>)
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

// names that would collide with routes or look official
export const RESERVED_USERNAMES = new Set([
    "admin", "administrator", "api", "about", "blog", "category", "contact", "editor", "help", "login",
    "logout", "me", "media", "moderator", "null", "register", "root", "settings", "support", "system",
    "tag", "undefined", "user", "users", "u", "www",
]);

export const DELETED_USER_NAME = "Deleted user";

// which host(s) each named social link must point at; "website" may be any https site
export const SOCIAL_LINK_HOSTS = {
    website: null,
    github: ["github.com"],
    twitter: ["twitter.com", "x.com"],
    linkedin: ["linkedin.com"],
    mastodon: null,
    youtube: ["youtube.com", "youtu.be"],
    instagram: ["instagram.com"],
};
