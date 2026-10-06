// usage: npm run admin:promote -- <email>
// Promotes an existing account to admin. This is how the first admin is created; after that,
// admins manage roles through PATCH /api/admin/users/:id/role.
import sequelize from "../database/dbconnection.js";
import { findUserByEmail, updateUserById } from "../repositories/userRepository.js";
import { recordAudit } from "../services/auditService.js";

const email = process.argv[2]?.trim().toLowerCase();

try {
    if (!email) {
        throw new Error("Usage: npm run admin:promote -- <email>");
    }
    const user = await findUserByEmail(email);
    if (!user || user.status === "deleted") {
        throw new Error(`No active account with email ${email}`);
    }
    if (user.role === "admin") {
        console.log(`${email} is already an admin.`);
    } else {
        await updateUserById(user.id, { role: "admin", emailVerifiedAt: user.emailVerifiedAt ?? new Date() });
        await recordAudit({
            actorId: null,
            action: "user.role_changed",
            entityType: "user",
            entityId: user.id,
            metadata: { from: user.role, to: "admin", via: "admin:promote script" },
        });
        console.log(`${email} is now an admin.`);
    }
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
} finally {
    await sequelize.close();
}
