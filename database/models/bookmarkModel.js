import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A post a person saved for later. Private to that person.
const Bookmark = sequelize.define('Bookmark', {
    userId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    postId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
}, { tableName: 'bookmarks', updatedAt: false });

export default Bookmark;
