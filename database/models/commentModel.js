import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A comment on a post; replies point at a top-level comment through parentId (one level only).
// A deleted comment keeps its row so the replies under it still make sense: body is NULL and deletedAt is set.
const Comment = sequelize.define('Comment', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    postId: { type: DataTypes.INTEGER, allowNull: false },
    userId: { type: DataTypes.INTEGER, allowNull: false },
    parentId: { type: DataTypes.INTEGER, allowNull: true },
    body: { type: DataTypes.STRING(2000), allowNull: true },
    editedAt: { type: DataTypes.DATE, allowNull: true },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'comments' });

export default Comment;
