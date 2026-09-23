import { Post, User } from "../database/models/index.js";

const authorInclude = { model: User, as: "author", attributes: ["id", "username"] };

// create a new post
export const createPost = async ({ title, content, userId }) => {
    const post = await Post.create({ title, content, userId });
    return findPostById(post.id);
};

// find all posts, newest first
export const findAllPosts = async () => {
    return await Post.findAll({ include: [authorInclude], order: [["createdAt", "DESC"]] });
};

// find a post by id
export const findPostById = async (id) => {
    return await Post.findByPk(id, { include: [authorInclude] });
};

// update a post by id
export const updatePostById = async (id, data) => {
    await Post.update(data, { where: { id } });
    return findPostById(id);
};

// delete a post by id
export const deletePostById = async (id) => {
    return await Post.destroy({ where: { id } });
};
