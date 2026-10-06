export const ROLES = Object.freeze({
    USER: "user",
    AUTHOR: "author",
    EDITOR: "editor",
    ADMIN: "admin",
});

// higher rank includes everything a lower rank can do
export const ROLE_RANK = Object.freeze({ user: 0, author: 1, editor: 2, admin: 3 });

export const hasRoleAtLeast = (role, minimum) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK[minimum];

// Permissions are assigned to the lowest role that holds them; higher roles inherit.
// Add a permission here in the phase that introduces the feature that checks it.
const MINIMUM_ROLE = Object.freeze({
    "post:create": ROLES.AUTHOR,
    "post:update_own": ROLES.AUTHOR,
    "post:delete_own": ROLES.AUTHOR,
    "media:upload_avatar": ROLES.USER,
    "media:delete_own": ROLES.USER,
    "media:upload_post_image": ROLES.AUTHOR,
    // editors review other people's work and can pull any post from public view; they cannot edit it
    "post:review": ROLES.EDITOR,
    "post:publish": ROLES.EDITOR,
    "post:moderate": ROLES.EDITOR,
    // sections and topics: editors keep the vocabulary tidy
    "category:manage": ROLES.EDITOR,
    "tag:manage": ROLES.EDITOR,
    // anyone with a verified account may write a comment; editors can remove any (the post's author can remove comments on their own post)
    "comment:create": ROLES.USER,
    "comment:moderate": ROLES.EDITOR,
    // readers flag things; editors decide about comments and stories; only admins see reports about people, and manage accounts
    "report:create": ROLES.USER,
    "report:review": ROLES.EDITOR,
    "report:review_users": ROLES.ADMIN,
    "user:read": ROLES.ADMIN,
    "user:suspend": ROLES.ADMIN,
    "stats:read": ROLES.ADMIN,
    // authors read the numbers of their own stories; admins read everything
    "analytics:read_own": ROLES.AUTHOR,
    "analytics:read_all": ROLES.ADMIN,
    "user:set_role": ROLES.ADMIN,
    "audit:read": ROLES.ADMIN,
});

export const PERMISSIONS = Object.freeze(Object.keys(MINIMUM_ROLE));

// unknown permission or unknown role => denied
export const roleHasPermission = (role, permission) =>
    MINIMUM_ROLE[permission] !== undefined && hasRoleAtLeast(role, MINIMUM_ROLE[permission]);
