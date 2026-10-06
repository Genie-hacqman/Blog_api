import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Single-use emailed token (verify email / reset password); only its hash is stored.
const UserToken = sequelize.define('UserToken', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    purpose: { type: DataTypes.ENUM('verify_email', 'reset_password'), allowNull: false },
    tokenHash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    usedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'user_tokens', updatedAt: false });

export default UserToken;
