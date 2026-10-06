import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// The inline images a post currently uses (the cover is the post's own coverMediaId). It is what
// keeps an image that is in use from being deleted, and lets unused images be swept.
const PostMedia = sequelize.define('PostMedia', {
    postId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    mediaId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
}, { tableName: 'post_media', updatedAt: false });

export default PostMedia;
