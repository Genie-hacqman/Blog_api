import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A free-form topic. Identified by its slug; `name` is the spelling shown to readers.
const Tag = sequelize.define('Tag', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(40), allowNull: false },
    slug: { type: DataTypes.STRING(50), allowNull: false, unique: true },
}, { tableName: 'tags' });

export default Tag;
