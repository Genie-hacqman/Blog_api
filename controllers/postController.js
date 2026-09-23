import {
    createPost as createPostService,
    getAllPosts as getAllPostsService,
    getPostById as getPostByIdService,
    updatePost as updatePostService,
    deletePost as deletePostService,
} from "../services/postService.js";

// check that a route param looks like a real post id before hitting the DB
const isValidId = (id) => Number.isInteger(Number(id));

// controller function to handle post creation
export const createPost = async (req, res) => {
    try {
        const post = await createPostService(req.user.id, req.body);
        return res.status(201).json({ message: "Post created successfully", post });
    } catch (error) {
        return res.status(500).json({ error: "Something went wrong" });
    }
};

// controller function to handle retrieving all posts
export const getAllPosts = async (req, res) => {
    try {
        const posts = await getAllPostsService();
        return res.status(200).json({ message: "Posts retrieved successfully", posts });
    } catch (error) {
        return res.status(500).json({ error: "Something went wrong" });
    }
};

// controller function to handle retrieving a single post by id
export const getPostById = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(404).json({ error: "Post not found" });
        }
        const post = await getPostByIdService(req.params.id);
        return res.status(200).json({ message: "Post retrieved successfully", post });
    } catch (error) {
        if (error.message === "Post not found") {
            return res.status(404).json({ error: error.message });
        }
        return res.status(500).json({ error: "Something went wrong" });
    }
};

// controller function to handle updating a post
export const updatePost = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(404).json({ error: "Post not found" });
        }
        const post = await updatePostService(req.params.id, req.user.id, req.body);
        return res.status(200).json({ message: "Post updated successfully", post });
    } catch (error) {
        if (error.message === "Post not found") {
            return res.status(404).json({ error: error.message });
        }
        if (error.message === "Not authorized to update this post") {
            return res.status(403).json({ error: error.message });
        }
        return res.status(500).json({ error: "Something went wrong" });
    }
};

// controller function to handle deleting a post
export const deletePost = async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.status(404).json({ error: "Post not found" });
        }
        await deletePostService(req.params.id, req.user.id);
        return res.status(200).json({ message: "Post deleted successfully" });
    } catch (error) {
        if (error.message === "Post not found") {
            return res.status(404).json({ error: error.message });
        }
        if (error.message === "Not authorized to delete this post") {
            return res.status(403).json({ error: error.message });
        }
        return res.status(500).json({ error: "Something went wrong" });
    }
};
