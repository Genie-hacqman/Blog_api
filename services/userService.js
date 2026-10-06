import { findUserById, updateUserById } from "../repositories/userRepository.js";
import { recordAudit } from "./auditService.js";
import { env } from "../config/env.js";
import { avatarUrlOf } from "../utils/author.js";
import { AppError, NotFoundError } from "../utils/AppError.js";

// shape of a user in API responses (never includes the password hash)
export const sanitizeUser = (user) => ({
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    userName: user.username,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerifiedAt),
    bio: user.bio ?? null,
    socialLinks: user.socialLinks ?? null,
    avatarUrl: avatarUrlOf(user),
    createAt: user.createdAt,
});

// self-service upgrade from "user" to "author": the one role change a person can make for themselves
export const becomeAuthor = async (userId, context) => {
    const user = await findUserById(userId, { withAvatar: true });
    if (!user) {
        throw new NotFoundError("User not found");
    }
    if (user.role !== "user") {
        return sanitizeUser(user);
    }
    if (env.REQUIRE_VERIFIED_EMAIL && !user.emailVerifiedAt) {
        throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address to become an author");
    }

    await updateUserById(userId, { role: "author" });
    await recordAudit({ actorId: userId, action: "user.became_author", entityType: "user", entityId: userId, metadata: { from: "user", to: "author" } }, { context });
    return sanitizeUser({ ...user.get(), role: "author" });
};
