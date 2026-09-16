const revokedTokens = new Set();

export const revokeToken = (token) => {
    revokedTokens.add(token);
};

export const isTokenRevoked = (token) => {
    return revokedTokens.has(token);
};
