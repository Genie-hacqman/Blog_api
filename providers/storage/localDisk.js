import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { assertSafeKey } from "./keys.js";

export const localRoot = () => path.resolve(env.STORAGE_LOCAL_DIR);

// Development storage: files in a folder, served by the API at /media (see app.js).
export const createLocalProvider = (root = localRoot()) => ({
    name: "local",
    async put({ key, body }) {
        assertSafeKey(key);
        const target = path.join(root, key);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, body);
    },
    async delete(key) {
        assertSafeKey(key);
        try {
            await unlink(path.join(root, key));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    },
    publicUrl: (key) => `${env.STORAGE_PUBLIC_URL}/${key}`,
});
