// An error that is safe to show to the client. Services throw these; the central
// errorHandler turns them into the response envelope. Anything else is a bug and
// is reported as a generic 500.
export class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export class ValidationError extends AppError {
    constructor(message = "Invalid request", details) {
        super(400, "VALIDATION_ERROR", message, details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message = "Authentication required") {
        super(401, "UNAUTHORIZED", message);
    }
}

export class ForbiddenError extends AppError {
    constructor(message = "You do not have permission to do that") {
        super(403, "FORBIDDEN", message);
    }
}

export class NotFoundError extends AppError {
    constructor(message = "Not found") {
        super(404, "NOT_FOUND", message);
    }
}

export class ConflictError extends AppError {
    constructor(message = "Conflict") {
        super(409, "CONFLICT", message);
    }
}

export class TooManyRequestsError extends AppError {
    constructor(message = "Too many requests. Please try again later.") {
        super(429, "RATE_LIMITED", message);
    }
}
