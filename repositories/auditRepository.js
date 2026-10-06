import { AuditLog, User } from "../database/models/index.js";

// Audit rows are only ever added and read; there is deliberately no update or delete here.
export const createAuditLog = async (entry, options = {}) => AuditLog.create(entry, options);

export const findAuditLogById = async (id) => AuditLog.findByPk(id);

export const listAuditLogs = async ({ action, actorId, entityType, entityId, limit, offset }) => {
    const where = {};
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = String(entityId);

    return AuditLog.findAndCountAll({
        where,
        include: [{ model: User, as: "actor", attributes: ["id", "username"] }],
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit,
        offset,
    });
};
