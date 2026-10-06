import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A saved version of a post. `version` counts up per post and never repeats.
const PostRevision = sequelize.define('PostRevision', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    excerpt: { type: DataTypes.STRING(320), allowNull: true },
    content: { type: DataTypes.TEXT('medium'), allowNull: false },
    createdBy: { type: DataTypes.INTEGER, allowNull: true },
    reason: { type: DataTypes.STRING(32), allowNull: false },
}, { tableName: 'post_revisions', updatedAt: false });

export default PostRevision;
