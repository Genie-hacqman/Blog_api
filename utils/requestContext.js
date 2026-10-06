// what services need to know about the caller's connection, without handing them the Express request
export const requestContext = (req) => ({
    ip: req.ip ? String(req.ip).slice(0, 45) : null,
    userAgent: req.get("user-agent")?.slice(0, 255) ?? null,
});
