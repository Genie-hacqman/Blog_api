import { DataTypes } from 'sequelize';
import sequelize from '../dbconnection.js';

// A section of the publication. A post has at most one; the slug is its public address and never changes.
const Category = sequelize.define('Category', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    slug: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    description: { type: DataTypes.STRING(300), allowNull: true },
}, { tableName: 'categories' });

export default Category;
