import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import logger from "../config/logger.js";

// only accept a client-supplied id if it cannot be used to inject into logs
const SAFE_REQUEST_ID = /^[\w-]{8,64}$/;

// one structured log line per request, tagged with a request id that is also
// returned in the x-request-id header so a user report can be traced to a log entry
export const requestLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
    },
    customLogLevel: (req, res, error) => {
        if (error || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
    },
    // health checks fire constantly from load balancers
    autoLogging: { ignore: (req) => req.url === "/health" },
});
