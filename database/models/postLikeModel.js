import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// One person liking one post; the composite key makes a second like impossible.
const PostLike = sequelize.define('PostLike', {
    postId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    userId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
}, { tableName: 'post_likes', updatedAt: false });

export default PostLike;
