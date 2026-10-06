import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A reader's report about a story, a comment or a person. Exactly one of postId / commentId / targetUserId is set
// and matches targetType (the service keeps that true). `targetKey` ("comment:12") is how reports about the same
// thing are grouped, and (reporterId, targetKey) is unique: one report per person per target.
const Report = sequelize.define('Report', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    reporterId: { type: DataTypes.INTEGER, allowNull: false },
    targetType: { type: DataTypes.STRING(10), allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: true },
    commentId: { type: DataTypes.INTEGER, allowNull: true },
    targetUserId: { type: DataTypes.INTEGER, allowNull: true },
    targetKey: { type: DataTypes.STRING(40), allowNull: false },
    reason: { type: DataTypes.STRING(20), allowNull: false },
    details: { type: DataTypes.STRING(500), allowNull: true },
    status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'open' },
    handledBy: { type: DataTypes.INTEGER, allowNull: true },
    handledAt: { type: DataTypes.DATE, allowNull: true },
    resolutionNote: { type: DataTypes.STRING(500), allowNull: true },
}, { tableName: 'reports', updatedAt: false });

export default Report;
