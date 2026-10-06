import { randomBytes } from "node:crypto";
import { findUserById, updateUserById } from "../repositories/userRepository.js";
import { revokeAllForUser } from "../repositories/refreshTokenRepository.js";
import { deleteTokensForUser } from "../repositories/userTokenRepository.js";
import { deleteUnpublishedByUser } from "../repositories/postRepository.js";
import { wipeCommentsByUser } from "../repositories/commentRepository.js";
import { removeLikesByUser } from "../repositories/likeRepository.js";
import { removeBookmarksByUser } from "../repositories/bookmarkRepository.js";
import { removeFollowsOfUser } from "../repositories/followRepository.js";
import { deleteNotificationsOfUser } from "../repositories/notificationRepository.js";
import { deletePreferencesOfUser } from "../repositories/notificationPreferenceRepository.js";
import { withTransaction } from "../database/transaction.js";
import { recordAudit } from "./auditService.js";
import { discardMedia } from "./mediaService.js";
import { sendAccountDeletedEmail } from "./emailService.js";
import { hashPassword, verifyPassword } from "../utils/hash.js";
import { AppError } from "../utils/AppError.js";

// Delete an account. The row is kept (published posts still point at it) but every personal
// detail is wiped, so what remains is an anonymous "Deleted user" that nobody can log in as.
//   - requires the current password (re-authentication)
//   - email and username are replaced, so both can be registered again
//   - every session ends; unpublished drafts are deleted; published posts stay
export const deleteAccount = async (userId, password, context) => {
    const user = await findUserById(userId, { withAvatar: true });

    const { valid } = await verifyPassword(password, user.password);
    if (!valid) {
        // 400, not 401: a 401 would make the client think the session expired
        throw new AppError(400, "INVALID_PASSWORD", "Password is incorrect");
    }

    // what the goodbye email needs, captured before the details are wiped
    const farewell = { id: user.id, email: user.email, firstName: user.firstName };
    const avatar = user.avatar;
    // a hash of random bytes nobody knows: the account can never be logged into again
    const unusablePassword = await hashPassword(randomBytes(32).toString("hex"));

    await withTransaction(async (transaction) => {
        await updateUserById(
            userId,
            {
                status: "deleted",
                deletedAt: new Date(),
                email: `deleted-${userId}@deleted.invalid`,
                username: `deleted-${userId}`,
                firstName: "Deleted",
                lastName: "User",
                password: unusablePassword,
                bio: null,
                socialLinks: null,
                avatarMediaId: null,
                emailVerifiedAt: null,
                lockedUntil: null,
                failedLoginCount: 0,
            },
            { transaction },
        );
        await revokeAllForUser(userId, { transaction });
        await deleteTokensForUser(userId, { transaction });
        await deleteUnpublishedByUser(userId, { transaction });
        // their reactions and follows (both ways) disappear; what they wrote in comments becomes a placeholder
        await removeLikesByUser(userId, { transaction });
        await removeBookmarksByUser(userId, { transaction });
        await removeFollowsOfUser(userId, { transaction });
        await wipeCommentsByUser(userId, { transaction });
        // their inbox and their notification choices go too
        await deleteNotificationsOfUser(userId, { transaction });
        await deletePreferencesOfUser(userId, { transaction });
        // no personal data in the audit row: the actor id is enough
        await recordAudit({ actorId: userId, action: "user.deleted", entityType: "user", entityId: userId }, { context, transaction });
    });

    if (avatar) {
        await discardMedia(avatar);
    }
    void sendAccountDeletedEmail(farewell);
};
