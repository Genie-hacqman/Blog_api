import {DataTypes} from 'sequelize';
import sequelize from '../dbconnection.js';

// Define the User model. The table itself is managed by database/migrations.
const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    firstName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    lastName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.ENUM('user', 'author', 'editor', 'admin'),
        allowNull: false,
        defaultValue: 'user',
    },
    status: {
        type: DataTypes.ENUM('active', 'suspended', 'deleted'),
        allowNull: false,
        defaultValue: 'active',
    },
    emailVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    failedLoginCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    bio: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },
    socialLinks: {
        type: DataTypes.JSON,
        allowNull: true,
    },
    avatarMediaId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // set when an admin suspends the account, cleared when they lift it
    suspendedAt: { type: DataTypes.DATE, allowNull: true },
    suspendedReason: { type: DataTypes.STRING(500), allowNull: true },
});

export default User;
