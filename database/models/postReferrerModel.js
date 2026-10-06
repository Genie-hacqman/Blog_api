import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Views of a story from one referring site (a hostname only) on one day.
const PostReferrer = sequelize.define('PostReferrer', {
    postId: { type: DataTypes.INTEGER, primaryKey: true },
    day: { type: DataTypes.DATEONLY, primaryKey: true },
    host: { type: DataTypes.STRING(100), primaryKey: true },
    views: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
}, { tableName: 'post_referrers_daily', timestamps: false });

export default PostReferrer;
