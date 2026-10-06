import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Something that happened that a person should know about. It holds ids only; the words are read when the
// inbox is opened. `inApp` says whether it shows in the inbox (a row also exists for an email-only choice).
const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    recipientId: { type: DataTypes.INTEGER, allowNull: false },
    actorId: { type: DataTypes.INTEGER, allowNull: true },
    type: { type: DataTypes.STRING(40), allowNull: false },
    postId: { type: DataTypes.INTEGER, allowNull: true },
    commentId: { type: DataTypes.INTEGER, allowNull: true },
    dedupeKey: { type: DataTypes.STRING(160), allowNull: false },
    // what a moderator wrote for the author of something that was removed
    note: { type: DataTypes.STRING(500), allowNull: true },
    inApp: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    emailedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'notifications', updatedAt: false });

export default Notification;
