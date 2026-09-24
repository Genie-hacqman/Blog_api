import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";

const validUser = {
    firstName: "Ada",
    lastName: "Lovelace",
    userName: "ada",
    email: "ada@example.com",
    password: "password123",
};

describe("auth", () => {
    before(resetDatabase);
    after(closeDatabase);

    it("registers a user and never returns the password", async () => {
        const response = await request(app).post("/api/users/register").send(validUser);

        assert.equal(response.status, 201);
        assert.equal(response.body.user.email, validUser.email);
        assert.equal(response.body.user.password, undefined);
        assert.ok(!JSON.stringify(response.body).includes(validUser.password));
    });

    it("rejects a duplicate email with 409", async () => {
        const response = await request(app)
            .post("/api/users/register")
            .send({ ...validUser, userName: "different" });

        assert.equal(response.status, 409);
        assert.equal(response.body.error, "Email is already taken");
    });

    it("rejects a duplicate username with 409", async () => {
        const response = await request(app)
            .post("/api/users/register")
            .send({ ...validUser, email: "different@example.com" });

        assert.equal(response.status, 409);
        assert.equal(response.body.error, "Username is already taken");
    });

    it("rejects a registration missing required fields with 400", async () => {
        const response = await request(app).post("/api/users/register").send({});

        assert.equal(response.status, 400);
    });

    it("rejects a password shorter than 8 characters with 400", async () => {
        const response = await request(app)
            .post("/api/users/register")
            .send({ ...validUser, userName: "shorty", email: "shorty@example.com", password: "short" });

        assert.equal(response.status, 400);
    });

    it("logs in with valid credentials and returns a token", async () => {
        const response = await request(app)
            .post("/api/users/login")
            .send({ email: validUser.email, password: validUser.password });

        assert.equal(response.status, 200);
        assert.ok(response.body.token);
        assert.equal(response.body.user.password, undefined);
    });

    it("rejects a wrong password with 401", async () => {
        const response = await request(app)
            .post("/api/users/login")
            .send({ email: validUser.email, password: "wrongpassword" });

        assert.equal(response.status, 401);
        assert.equal(response.body.error, "Invalid email or password");
    });

    it("rejects an unknown email with 401", async () => {
        const response = await request(app)
            .post("/api/users/login")
            .send({ email: "nobody@example.com", password: "password123" });

        assert.equal(response.status, 401);
        assert.equal(response.body.error, "Invalid email or password");
    });

    it("revokes the token on logout so it can no longer be used", async () => {
        const { token } = await registerAndLogin();

        const logout = await request(app)
            .post("/api/users/logout")
            .set("Authorization", `Bearer ${token}`);

        assert.equal(logout.status, 200);

        const afterLogout = await request(app)
            .post("/api/posts")
            .set("Authorization", `Bearer ${token}`)
            .send({ title: "Should fail", content: "Token was revoked" });

        assert.equal(afterLogout.status, 401);
        assert.equal(afterLogout.body.error, "Token has been revoked");
    });
});
