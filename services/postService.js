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
    author: post.author ? { id: post.author.id, username: post.author.username } : null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
});

// create a new post
export const createPost = async (userId, { title, content }) => {
    const post = await createPostRecord({ title, content, userId });
    return sanitizePost(post);
};

// get all posts
export const getAllPosts = async () => {
    const posts = await findAllPosts();
    return posts.map(sanitizePost);
};

// get a single post by id
export const getPostById = async (id) => {
    const post = await findPostById(id);
    if (!post) {
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
