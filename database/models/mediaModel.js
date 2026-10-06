import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A stored image. The row says where it lives (key) and what it is; the URL comes from the storage provider.
const Media = sequelize.define('Media', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    ownerId: { type: DataTypes.INTEGER, allowNull: false },
    key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    mime: { type: DataTypes.STRING(50), allowNull: false },
    size: { type: DataTypes.INTEGER, allowNull: false },
    width: { type: DataTypes.INTEGER, allowNull: false },
    height: { type: DataTypes.INTEGER, allowNull: false },
    purpose: { type: DataTypes.ENUM('avatar', 'cover', 'inline'), allowNull: false },
    deletedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'media', updatedAt: false });

export default Media;
