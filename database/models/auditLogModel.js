import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Append-only: nothing in the codebase updates or deletes these rows.
const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    actorId: { type: DataTypes.INTEGER, allowNull: true },
    action: { type: DataTypes.STRING(64), allowNull: false },
    entityType: { type: DataTypes.STRING(32), allowNull: false },
    entityId: { type: DataTypes.STRING(64), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: true },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
}, { tableName: 'audit_logs', updatedAt: false });

export default AuditLog;
