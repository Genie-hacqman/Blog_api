import { createAuditLog, listAuditLogs } from "../repositories/auditRepository.js";
import { sanitizeMetadata } from "../utils/sanitizeMetadata.js";
import logger from "../config/logger.js";

// Record a security-relevant action. Never put passwords, tokens or hashes in `metadata`
// (they are stripped anyway, see sanitizeMetadata).
//
// - Pass `transaction` for admin/privileged changes: the audit row then commits or rolls
//   back together with the change, and a failure to write it aborts the action.
// - Without one (auth events), the write is best-effort: a failure is logged, never thrown.
export const recordAudit = async ({ actorId = null, action, entityType, entityId = null, metadata }, { context = {}, transaction } = {}) => {
    const row = {
        actorId,
        action,
        entityType,
        entityId: entityId === null ? null : String(entityId),
        metadata: metadata ? sanitizeMetadata(metadata) : null,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
    };

    if (transaction) {
        return createAuditLog(row, { transaction });
    }
    try {
        return await createAuditLog(row);
    } catch (error) {
        logger.error({ err: error, action }, "Failed to write audit log");
    }
};

const toEntry = (log) => ({
    id: log.id,
    actor: log.actor ? { id: log.actor.id, username: log.actor.username } : null,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    metadata: log.metadata,
    ip: log.ip,
    createdAt: log.createdAt,
});

export const getAuditLogs = async ({ page, limit, action, actorId, entityType, entityId }) => {
    const { rows, count } = await listAuditLogs({ action, actorId, entityType, entityId, limit, offset: (page - 1) * limit });
    return {
        logs: rows.map(toEntry),
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
};
