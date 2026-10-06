import { roleHasPermission } from "../config/roles.js";
import { TARGET_TYPES } from "../config/moderation.js";

// Which kinds of report a moderator may see and decide. Editors handle comments and stories; reports about people
// go to admins only, because only admins can suspend. Anything else is "not found" to them.
export const reportTypesFor = (role) =>
    TARGET_TYPES.filter((type) => roleHasPermission(role, type === "user" ? "report:review_users" : "report:review"));
