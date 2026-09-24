import { createHash } from "node:crypto";
import { getIdempotentResponse, saveIdempotentResponse } from "../utils/idempotencyStore.js";

const hashBody = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

// replay a cached response for a repeated Idempotency-Key, or cache the
// response of a new one. Requires authenticate to run first (needs req.user.id).
export const idempotent = () => (req, res, next) => {
    const idempotencyKey = req.headers["idempotency-key"];

    if (!idempotencyKey) {
        return next();
    }

    const storeKey = `${req.user.id}:${idempotencyKey}`;
    const requestHash = hashBody(req.body);
    const cached = getIdempotentResponse(storeKey);

    if (cached) {
        if (cached.requestHash !== requestHash) {
            return res.status(409).json({ error: "Idempotency-Key has already been used with a different request body" });
        }
        return res.status(cached.status).json(cached.body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode < 500) {
            saveIdempotentResponse(storeKey, { requestHash, status: res.statusCode, body });
        }
        return originalJson(body);
    };

    next();
};
