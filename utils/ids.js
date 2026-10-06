import { NotFoundError } from "./AppError.js";

// a route param must look like a real id before we hit the DB; anything else is simply "not found"
export const requireValidId = (id, what = "Post") => {
    if (!/^\d+$/.test(String(id))) {
        throw new NotFoundError(`${what} not found`);
    }
    return Number(id);
};
