import user from "../database/models/userModel.js";

// find user by id
export const findUserById = async (id) => {
    return await user.findByPk(id);
};

// find user by username
export const findUserByUsername = async (username) => {
    return await user.findOne({ where: { username } });
};

// find user by email
export const findUserByEmail = async (email) => {
    return await user.findOne({ where: { email } });
}


export const createUser = async ({ firstName, lastName, username, email, password }) => {
    return await user.create({ firstName, lastName, username, email, password });
};

