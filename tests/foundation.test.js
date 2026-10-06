import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import pino from "pino";
import { Post } from "../database/models/index.js";
import { redactPaths } from "../config/logger.js";

const validUser = {
    firstName: "Race",
    lastName: "Condition",
    userName: "racer",
    email: "racer@example.com",
    password: "password123",
};

describe("foundation", () => {
    before(resetDatabase);
    after(closeDatabase);

    describe("GET /health", () => {
        it("reports ok when the database is reachable", async () => {
            const response = await request(app).get("/health");

            assert.equal(response.status, 200);
            assert.equal(response.body.success, true);
            assert.equal(response.body.data.status, "ok");
            assert.equal(response.body.data.checks.database, "up");
        });
    });

    describe("error envelope", () => {
        it("answers an unknown route with a 404 envelope", async () => {
            const response = await request(app).get("/api/does-not-exist");

            assert.equal(response.status, 404);
            assert.equal(response.body.success, false);
            assert.equal(response.body.error.code, "NOT_FOUND");
        });

        it("answers malformed JSON with 400 INVALID_JSON and no stack trace", async () => {
            const response = await request(app)
                .post("/api/auth/login")
                .set("Content-Type", "application/json")
                .send('{"email": ');

            assert.equal(response.status, 400);
            assert.equal(response.body.error.code, "INVALID_JSON");
            assert.ok(!JSON.stringify(response.body).includes("at "), "response must not contain a stack trace");
        });

        it("rejects an oversized body with 413", async () => {
            const response = await request(app)
                .post("/api/auth/login")
                .send({ email: "a@example.com", password: "x".repeat(300_000) });

            assert.equal(response.status, 413);
            assert.equal(response.body.error.code, "PAYLOAD_TOO_LARGE");
        });

        it("returns VALIDATION_ERROR with every issue in details", async () => {
            const response = await request(app).post("/api/auth/register").send({});

            assert.equal(response.status, 400);
            assert.equal(response.body.error.code, "VALIDATION_ERROR");
            assert.ok(response.body.error.details.issues.length > 1);
            assert.ok(response.body.error.details.issues.every((issue) => issue.path && issue.message));
        });

        it("uses the envelope for 401s", async () => {
            const response = await request(app).get("/api/auth/me");

            assert.equal(response.status, 401);
            assert.equal(response.body.error.code, "UNAUTHORIZED");
        });
    });

    describe("security headers and request ids", () => {
        it("sends helmet headers and hides X-Powered-By", async () => {
            const response = await request(app).get("/health");

            assert.equal(response.headers["x-powered-by"], undefined);
            assert.equal(response.headers["x-content-type-options"], "nosniff");
        });

        it("generates a request id and echoes a well-formed client one", async () => {
            const generated = await request(app).get("/health");
            assert.match(generated.headers["x-request-id"], /^[\w-]{8,64}$/);

            const echoed = await request(app).get("/health").set("x-request-id", "trace-abc-12345");
            assert.equal(echoed.headers["x-request-id"], "trace-abc-12345");
        });

        it("replaces a client request id that could inject into logs", async () => {
            const response = await request(app).get("/health").set("x-request-id", "bad id with spaces");

            assert.notEqual(response.headers["x-request-id"], "bad id with spaces");
            assert.match(response.headers["x-request-id"], /^[\w-]{8,64}$/);
        });
    });

    describe("log redaction", () => {
        it("censors credentials in logged requests", () => {
            const lines = [];
            const logger = pino({ redact: { paths: redactPaths, censor: "[redacted]" } }, { write: (line) => lines.push(line) });

            logger.info({
                req: { headers: { authorization: "Bearer secret-jwt", cookie: "refresh=secret-cookie", accept: "*/*" } },
                body: { password: "hunter2hunter2", token: "secret-token" },
            });

            const output = lines.join("");
            for (const secret of ["secret-jwt", "secret-cookie", "hunter2hunter2", "secret-token"]) {
                assert.ok(!output.includes(secret), `${secret} leaked into the log line`);
            }
            assert.ok(output.includes("*/*"), "non-secret headers should still be logged");
        });
    });

    describe("registration race", () => {
        it("returns 409 (not 500) when two identical registrations arrive together", async () => {
            const responses = await Promise.all([
                request(app).post("/api/auth/register").send(validUser),
                request(app).post("/api/auth/register").send(validUser),
            ]);

            const statuses = responses.map((response) => response.status).sort();
            assert.deepEqual(statuses, [201, 409]);
        });
    });

    describe("post limits and storage", () => {
        it("rejects a title longer than the column with 400", async () => {
            const { token } = await registerAndLogin();
            const response = await request(app)
                .post("/api/posts")
                .set("Authorization", `Bearer ${token}`)
                .send({ title: "t".repeat(256), content: "body" });

            assert.equal(response.status, 400);
        });

        it("rejects content over 50,000 characters with 400", async () => {
            const { token } = await registerAndLogin();
            const response = await request(app)
                .post("/api/posts")
                .set("Authorization", `Bearer ${token}`)
                .send({ title: "Too long", content: "a".repeat(50_001) });

            assert.equal(response.status, 400);
        });

        it("stores a long multi-byte post that would overflow a TEXT column", async () => {
            const { token } = await registerAndLogin();
            const content = "é".repeat(50_000); // ~100 KB in UTF-8, over TEXT's 64 KB limit
            const created = await request(app)
                .post("/api/posts")
                .set("Authorization", `Bearer ${token}`)
                .send({ title: "Long", content });

            assert.equal(created.status, 201);

            const fetched = await request(app)
                .get(`/api/posts/${created.body.data.post.id}`)
                .set("Authorization", `Bearer ${token}`);
            assert.equal(fetched.body.data.post.content, `<p>${content}</p>`, "plain text is stored as a paragraph of HTML");
        });

        it("enforces the Posts.userId foreign key in the database", async () => {
            await assert.rejects(
                () => Post.create({ title: "Orphan", content: "No such author", userId: 999999 }),
                { name: "SequelizeForeignKeyConstraintError" },
            );
        });
    });
});
