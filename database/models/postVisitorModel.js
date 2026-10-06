import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Tells one visitor from another within a day: a one-way hash that changes every day. No address, no browser
// string, no account. Rows are deleted after two days.
const PostVisitor = sequelize.define('PostVisitor', {
    postId: { type: DataTypes.INTEGER, primaryKey: true },
    day: { type: DataTypes.DATEONLY, primaryKey: true },
    visitorHash: { type: DataTypes.CHAR(32), primaryKey: true },
    lastViewAt: { type: DataTypes.DATE, allowNull: false },
    timingReported: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'post_visitors', timestamps: false });

export default PostVisitor;
