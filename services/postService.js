import {
    createPost as createPostRecord,
    findAllPosts,
    findPostById,
    updatePostById,
    deletePostById,
} from "../repositories/postRepository.js";

// sanitize a post for API responses
const sanitizePost = (post) => ({
    id: post.id,
    title: post.title,
    content: post.content,
    status: post.status,
    author: post.author ? { id: post.author.id, username: post.author.username } : null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
});

const EXCERPT_LENGTH = 320;
const WORDS_PER_MINUTE = 225;

// a public preview of a post: enough to tease the story without giving away the full content
const summarizePost = (post) => {
    const content = post.content ?? "";
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    return {
        id: post.id,
        title: post.title,
        excerpt: content.length > EXCERPT_LENGTH ? `${content.slice(0, EXCERPT_LENGTH).trimEnd()}…` : content,
        readingTime: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
        author: post.author ? { id: post.author.id, username: post.author.username } : null,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
    };
};

// create a new post
export const createPost = async (userId, { title, content, status }) => {
    const post = await createPostRecord({ title, content, userId, status });
    return sanitizePost(post);
};

// get published posts as previews, paginated
export const getAllPosts = async ({ page, limit }) => {
    const offset = (page - 1) * limit;
    const { rows, count } = await findAllPosts({ status: "published", limit, offset });
    return {
        posts: rows.map(summarizePost),
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
};

// get a single post by id; drafts are only visible to their author
export const getPostById = async (id, requestingUserId) => {
    const post = await findPostById(id);
    if (!post) {
        throw new Error("Post not found");
    }
    if (post.status === "draft" && post.userId !== requestingUserId) {
        throw new Error("Post not found");
    }
    return sanitizePost(post);
};

// update a post, only if the requesting user is the author
export const updatePost = async (id, userId, data) => {
    const post = await findPostById(id);
    if (!post) {
        throw new Error("Post not found");
    }
    if (post.userId !== userId) {
        throw new Error("Not authorized to update this post");
    }
    const updatedPost = await updatePostById(id, data);
    return sanitizePost(updatedPost);
};

// delete a post, only if the requesting user is the author
export const deletePost = async (id, userId) => {
    const post = await findPostById(id);
    if (!post) {
        throw new Error("Post not found");
    }
    if (post.userId !== userId) {
        throw new Error("Not authorized to delete this post");
    }
    await deletePostById(id);
};
