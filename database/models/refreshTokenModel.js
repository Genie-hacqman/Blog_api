import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// One issued refresh token; rows with the same familyId form one login session.
const RefreshToken = sequelize.define('RefreshToken', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    familyId: { type: DataTypes.CHAR(36), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    replacedById: { type: DataTypes.INTEGER, allowNull: true },
    ip: { type: DataTypes.STRING(45), allowNull: true },
    userAgent: { type: DataTypes.STRING(255), allowNull: true },
}, { tableName: 'refresh_tokens', updatedAt: false });

export default RefreshToken;
