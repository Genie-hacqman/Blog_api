import request from "supertest";
import sequelize from "../database/dbconnection.js";
import { Post, User } from "../database/models/index.js";
import app from "../app.js";

// The models fire Model.sync() at import time without awaiting it. Dropping
// tables here would yank them out from under those in-flight calls, so this
// only ever creates-if-missing and then empties the rows.
export const resetDatabase = async () => {
    await sequelize.sync();
    await Post.destroy({ truncate: true, restartIdentity: true });
    await User.destroy({ truncate: true, restartIdentity: true });
};

export const closeDatabase = async () => {
    await sequelize.close();
};

let userCount = 0;

export const registerAndLogin = async (overrides = {}) => {
    userCount += 1;
    const credentials = {
        firstName: "Test",
        lastName: "User",
        userName: `testuser${userCount}`,
        email: `testuser${userCount}@example.com`,
        password: "password123",
        ...overrides,
    };

    await request(app).post("/api/users/register").send(credentials);

    const response = await request(app)
        .post("/api/users/login")
        .send({ email: credentials.email, password: credentials.password });

    return { user: response.body.user, token: response.body.token, credentials };
};

export { app, request };
