import { searchPublishedPosts } from "../../repositories/searchRepository.js";

// Search backed by the database's own full-text indexes. It ranks, filters and counts inside MySQL and
// returns only post ids. A dedicated engine (Meilisearch, Typesense...) would implement the same
// `search()` and return ids in the same shape; nothing above this file would change.
export const createMysqlSearchProvider = () => ({
    name: "mysql",

    // { query, terms, tagSlugs, usernames, categoryId?, tagId?, sort, limit, offset } -> { ids: [ranked post ids], total }
    search: ({ query, terms, tagSlugs, usernames, categoryId, tagId, sort, limit, offset }) =>
        searchPublishedPosts({ terms, tagSlugs, usernames, titleFallbackFor: query, categoryId, tagId, sort, limit, offset }),
});
