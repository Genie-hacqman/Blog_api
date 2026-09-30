import { Post, User } from "../database/models/index.js";

const authorInclude = { model: User, as: "author", attributes: ["id", "username"] };

// create a new post
export const createPost = async ({ title, content, userId, status }) => {
    const post = await Post.create({ title, content, userId, status });
    return findPostById(post.id);
};

// find all posts, newest first, optionally filtered by status and paginated
export const findAllPosts = async ({ status, limit, offset } = {}) => {
    const where = status ? { status } : {};
    return await Post.findAndCountAll({
        where,
        include: [authorInclude],
        order: [["createdAt", "DESC"]],
        limit,
        offset,
    });
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
