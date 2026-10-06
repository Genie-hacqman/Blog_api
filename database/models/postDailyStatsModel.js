import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// The totals for one story on one UTC day. Counters only; nothing here is about a person.
const PostDailyStats = sequelize.define('PostDailyStats', {
    postId: { type: DataTypes.INTEGER, primaryKey: true },
    day: { type: DataTypes.DATEONLY, primaryKey: true },
    views: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    uniques: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    readCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    timed: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    readSeconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
}, { tableName: 'post_daily_stats', timestamps: false });

export default PostDailyStats;
