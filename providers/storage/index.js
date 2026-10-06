import { env } from "../../config/env.js";
import { createLocalProvider } from "./localDisk.js";
import { createMemoryProvider } from "./memory.js";
import { createS3Provider } from "./s3.js";

// the rest of the app only calls getStorage().put / delete / publicUrl
const factories = {
    local: createLocalProvider,
    memory: createMemoryProvider,
    s3: createS3Provider,
};

let provider;

export const getStorage = () => {
    provider ??= factories[env.STORAGE_PROVIDER]();
    return provider;
};
