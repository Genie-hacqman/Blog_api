import { env } from "../../config/env.js";
import { createMysqlSearchProvider } from "./mysql.js";

// the rest of the app only calls getSearchProvider().search(...)
const factories = { mysql: createMysqlSearchProvider };

let provider;

export const getSearchProvider = () => {
    provider ??= factories[env.SEARCH_PROVIDER]();
    return provider;
};

// tests swap the engine to prove nothing depends on how it works; pass nothing to restore the configured one
export const setSearchProviderForTests = (replacement) => {
    provider = replacement;
};
