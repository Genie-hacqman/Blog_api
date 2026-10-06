// Success envelope: { success: true, data, meta? }. Errors use the matching
// { success: false, error: { code, message, details? } } shape from middleware/errorHandler.js.
export const sendSuccess = (res, status, data = null, meta) => {
    const body = { success: true, data };
    if (meta !== undefined) {
        body.meta = meta;
    }
    return res.status(status).json(body);
};
