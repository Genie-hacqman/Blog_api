import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// Which tags a post carries. The composite primary key means a post cannot have the same tag twice.
const PostTag = sequelize.define('PostTag', {
    postId: { type: DataTypes.INTEGER, primaryKey: true },
    tagId: { type: DataTypes.INTEGER, primaryKey: true },
}, { tableName: 'post_tags', updatedAt: false });

export default PostTag;
