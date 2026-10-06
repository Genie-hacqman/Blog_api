import { addBookmark, hasBookmarked, removeBookmark } from "../repositories/bookmarkRepository.js";
import { addLike, countLikes, countLikesForPosts, hasLiked, removeLike } from "../repositories/likeRepository.js";
import { countCommentsForPosts } from "../repositories/commentRepository.js";
import { findPostById } from "../repositories/postRepository.js";
import { attachTags } from "./tagService.js";
import { NotFoundError } from "../utils/AppError.js";

// Put each post's like and comment counts on the post object, with two queries for the whole page
// (never one per post). Returns the same posts for chaining.
export const attachCounts = async (posts) => {
    const ids = posts.map((post) => post.id);
    const [likes, comments] = await Promise.all([countLikesForPosts(ids), countCommentsForPosts(ids)]);
    for (const post of posts) {
        post.likeCount = likes.get(post.id) ?? 0;
        post.commentCount = comments.get(post.id) ?? 0;
    }
    return posts;
};

// everything a list or a detail page needs besides the post's own columns: its topics and its counts.
// Call it AFTER the transaction that changed the posts has committed (both read on another connection).
export const attachPostData = async (posts) => {
    await Promise.all([attachTags(posts), attachCounts(posts)]);
    return posts;
};

// What the signed-in viewer has done with this post (post.liked, post.bookmarked).
export const attachViewerState = async (post, viewer) => {
    if (!viewer) return post;
    const [liked, bookmarked] = await Promise.all([hasLiked(post.id, viewer.id), hasBookmarked(viewer.id, post.id)]);
    post.liked = liked;
    post.bookmarked = bookmarked;
    return post;
};

// Reactions only exist on published posts. Anything else is "not found", exactly like a missing post,
// so nobody can probe for drafts by liking them.
const publishedOrNotFound = async (postId) => {
    const post = await findPostById(postId);
    if (!post || post.status !== "published") throw new NotFoundError("Post not found");
    return post;
};

// All four are idempotent: asking for the state the post is already in succeeds and changes nothing.
export const likePost = async (postId, user) => {
    await publishedOrNotFound(postId);
    await addLike(postId, user.id);
    return { liked: true, likeCount: await countLikes(postId) };
};

export const unlikePost = async (postId, user) => {
    await publishedOrNotFound(postId);
    await removeLike(postId, user.id);
    return { liked: false, likeCount: await countLikes(postId) };
};

export const bookmarkPost = async (postId, user) => {
    await publishedOrNotFound(postId);
    await addBookmark(user.id, postId);
    return { bookmarked: true };
};

export const unbookmarkPost = async (postId, user) => {
    await publishedOrNotFound(postId);
    await removeBookmark(user.id, postId);
    return { bookmarked: false };
};
