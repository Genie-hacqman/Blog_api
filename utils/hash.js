import argon2 from "argon2";
import bcrypt from "bcryptjs";

// OWASP minimum for argon2id: 19 MiB memory, 2 iterations, 1 lane
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, ARGON2_OPTIONS);

const isBcryptHash = (hash) => hash.startsWith("$2");

// Returns { valid, needsRehash }. Accounts created before argon2id was adopted still
// carry bcrypt hashes; they verify fine and are flagged so the caller can upgrade them.
export const verifyPassword = async (plain, hash) => {
    if (isBcryptHash(hash)) {
        const valid = await bcrypt.compare(plain, hash);
        return { valid, needsRehash: valid };
    }
    const valid = await argon2.verify(hash, plain);
    return { valid, needsRehash: valid && argon2.needsRehash(hash, ARGON2_OPTIONS) };
};

// verified against when the email is unknown, so "no such user" costs as much time as "wrong password"
const dummyHash = hashPassword("not-a-real-password");
export const burnPasswordCheck = async (plain) => {
    await argon2.verify(await dummyHash, plain);
};
