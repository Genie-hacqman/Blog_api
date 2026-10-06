import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// One person's choice for one kind of notification. A missing row means the kind's default.
const NotificationPreference = sequelize.define('NotificationPreference', {
    userId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    type: { type: DataTypes.STRING(40), primaryKey: true, allowNull: false },
    inApp: { type: DataTypes.BOOLEAN, allowNull: false },
    email: { type: DataTypes.BOOLEAN, allowNull: false },
}, { tableName: 'notification_preferences', createdAt: false });

export default NotificationPreference;
