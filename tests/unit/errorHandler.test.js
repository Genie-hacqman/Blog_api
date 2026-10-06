import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../../middleware/errorHandler.js";
import { ConflictError, ValidationError } from "../../utils/AppError.js";

// run the handler against a fake request/response and capture what it sends
const run = (error, { headersSent = false } = {}) => {
    const logged = [];
    const req = { log: { error: (...args) => logged.push(args) } };
    const result = { logged, forwarded: null };
    const res = {
        headersSent,
        status(code) {
            result.status = code;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        },
    };
    errorHandler(error, req, res, (forwarded) => {
        result.forwarded = forwarded;
    });
    return result;
};

describe("errorHandler", () => {
    it("renders an AppError with its status, code and details", () => {
        const { status, body } = run(new ValidationError("bad input", { issues: [{ path: "title", message: "bad input" }] }));

        assert.equal(status, 400);
        assert.deepEqual(body, {
            success: false,
            error: { code: "VALIDATION_ERROR", message: "bad input", details: { issues: [{ path: "title", message: "bad input" }] } },
        });
    });

    it("omits details when there are none", () => {
        const { body } = run(new ConflictError("taken"));

        assert.equal("details" in body.error, false);
    });

    it("maps a Sequelize unique violation on email to 409", () => {
        const error = Object.assign(new Error("Validation error"), {
            name: "SequelizeUniqueConstraintError",
            errors: [{ path: "email" }],
        });
        const { status, body } = run(error);

        assert.equal(status, 409);
        assert.equal(body.error.message, "Email is already taken");
    });

    it("hides the message and stack of unexpected errors and logs them", () => {
        const { status, body, logged } = run(new Error("connect ECONNREFUSED 10.0.0.5:3306"));

        assert.equal(status, 500);
        assert.deepEqual(body, { success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
        assert.ok(!JSON.stringify(body).includes("ECONNREFUSED"));
        assert.equal(logged.length, 1);
    });

    it("defers to Express when the response has already started", () => {
        const error = new Error("late");
        const { forwarded, status } = run(error, { headersSent: true });

        assert.equal(forwarded, error);
        assert.equal(status, undefined);
    });
});
