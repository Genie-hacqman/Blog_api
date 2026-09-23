const idempotencyStore = new Map();

export const getIdempotentResponse = (key) => {
    return idempotencyStore.get(key);
};

export const saveIdempotentResponse = (key, entry) => {
    idempotencyStore.set(key, entry);
};
