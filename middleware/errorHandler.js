import { AppError, NotFoundError } from "../utils/AppError.js";

// anything that reaches this without matching a route
export const notFoundHandler = (req, res, next) => next(new NotFoundError("Route not found"));

// map errors thrown by libraries (body parser, Sequelize) onto client-safe AppErrors
const normalizeError = (error) => {
    if (error instanceof AppError) {
        return error;
    }

    // express.json(): malformed or oversized bodies
    if (error.type === "entity.parse.failed") {
        return new AppError(400, "INVALID_JSON", "Request body is not valid JSON");
    }
    if (error.type === "entity.too.large") {
        return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    }

    // multer (multipart uploads)
    if (error.name === "MulterError") {
        if (error.code === "LIMIT_FILE_SIZE") {
            return new AppError(413, "PAYLOAD_TOO_LARGE", "That file is too large");
        }
        return new AppError(400, "INVALID_UPLOAD", 'Upload one image in the "file" field');
    }

    // a unique index rejected the write (e.g. two concurrent registrations with the same email)
    if (error.name === "SequelizeUniqueConstraintError") {
        const fields = error.errors?.map((e) => e.path ?? "").join(" ") ?? "";
        if (fields.includes("email")) return new AppError(409, "CONFLICT", "Email is already taken");
        if (fields.includes("username")) return new AppError(409, "CONFLICT", "Username is already taken");
        return new AppError(409, "CONFLICT", "Resource already exists");
    }

    return null;
};

// the single place errors become HTTP responses. Unknown errors are logged with the
// request id and reported generically: no message, no stack trace reaches the client.
export const errorHandler = (error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const appError = normalizeError(error);

    if (!appError) {
        (req.log ?? console).error({ err: error }, "Unhandled error");
        return res.status(500).json({
            success: false,
            error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
        });
    }

    const body = { success: false, error: { code: appError.code, message: appError.message } };
    if (appError.details !== undefined) {
        body.error.details = appError.details;
    }
    return res.status(appError.status).json(body);
};
