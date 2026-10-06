const SECRET_KEY = /pass|token|secret|authorization|cookie|hash/i;

// audit metadata is stored and shown to admins, so anything credential-shaped is dropped, at any depth
export const sanitizeMetadata = (value) => {
    if (Array.isArray(value)) {
        return value.map(sanitizeMetadata);
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => !SECRET_KEY.test(key))
                .map(([key, inner]) => [key, sanitizeMetadata(inner)]),
        );
    }
    return value;
};
