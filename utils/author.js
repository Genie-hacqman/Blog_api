import { getStorage } from "../providers/storage/index.js";
import { DELETED_USER_NAME } from "../config/profile.js";

// public URL of a user's profile photo (the user must have been loaded with its `avatar` include)
export const avatarUrlOf = (user) => (user?.avatar?.key ? getStorage().publicUrl(user.avatar.key) : null);

// How an author appears on a post. Deleted accounts are shown generically and carry no avatar.
export const toAuthor = (author) => {
    if (!author) return null;
    if (author.status === "deleted") {
        return { id: author.id, username: DELETED_USER_NAME, avatarUrl: null, deleted: true };
    }
    return { id: author.id, username: author.username, avatarUrl: avatarUrlOf(author) };
};
