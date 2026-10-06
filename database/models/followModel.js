import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// followerId follows followingId. The database refuses a row where both are the same person.
const Follow = sequelize.define('Follow', {
    followerId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
    followingId: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false },
}, { tableName: 'follows', updatedAt: false });

export default Follow;
