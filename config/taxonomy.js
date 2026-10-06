// Limits for categories, tags and search.
export const MAX_TAGS_PER_POST = 5;
export const TAG_NAME_MIN = 2;
export const TAG_NAME_MAX = 30;
export const TAG_LIST_MAX = 50;

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 60;
export const CATEGORY_DESCRIPTION_MAX = 300;

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 100;
export const SEARCH_MAX_TERMS = 8;
// deep paging into an expensive query is capped
export const SEARCH_MAX_PAGE = 100;
// InnoDB full-text search does not index words shorter than this (innodb_ft_min_token_size)
export const FULLTEXT_MIN_TOKEN = 3;
