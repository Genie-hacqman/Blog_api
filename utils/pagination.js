const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// parse page/limit query params into sane, bounded integers; maxPage stops absurdly deep paging on costly queries
export const parsePagination = (query, { maxPage = Infinity } = {}) => {
    const page = Math.min(maxPage, Math.max(1, parseInt(query.page, 10) || 1));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT));
    return { page, limit };
};
