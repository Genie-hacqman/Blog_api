import { findBookmarkPage } from "../repositories/bookmarkRepository.js";
import { findPublishedByIds, findPublishedPage } from "../repositories/postRepository.js";
import { attachPostData } from "./engagementService.js";
import { toPreview } from "./postService.js";

const pagination = (page, limit, count) => ({ page, limit, total: count, totalPages: Math.ceil(count / limit) });

// the signed-in user's feed: published posts by the people they follow, newest first
export const getFeed = async (user, { page, limit }) => {
    const { rows, count } = await findPublishedPage({ followedBy: user.id, limit, offset: (page - 1) * limit });
    await attachPostData(rows);
    return { posts: rows.map(toPreview), pagination: pagination(page, limit, count) };
};

// the signed-in user's saved posts, most recently saved first (only those that are published right now)
export const listBookmarks = async (user, { page, limit }) => {
    const { postIds, count } = await findBookmarkPage({ userId: user.id, limit, offset: (page - 1) * limit });
    const posts = await attachPostData(await findPublishedByIds(postIds));
    return { posts: posts.map(toPreview), pagination: pagination(page, limit, count) };
};
