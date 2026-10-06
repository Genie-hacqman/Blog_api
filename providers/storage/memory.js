import { env } from "../../config/env.js";
import { assertSafeKey } from "./keys.js";

// Test storage: objects live in a Map so tests can inspect exactly what would have been stored.
export const storedFiles = new Map();

export const clearStoredFiles = () => storedFiles.clear();

export const createMemoryProvider = () => ({
    name: "memory",
    async put({ key, body, contentType }) {
        assertSafeKey(key);
        storedFiles.set(key, { body, contentType });
    },
    async delete(key) {
        assertSafeKey(key);
        storedFiles.delete(key);
    },
    publicUrl: (key) => `${env.STORAGE_PUBLIC_URL}/${key}`,
});
