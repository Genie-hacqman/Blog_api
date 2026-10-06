import {DataTypes} from 'sequelize';
import sequelize from '../dbconnection.js';

// Define the Post model. The table itself is managed by database/migrations.
const Post = sequelize.define('Post', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    content: {
        type: DataTypes.TEXT('medium'),
        allowNull: false,
    },
    // the readable text inside `content` (which is sanitized HTML); search, excerpts and reading time work from it
    contentText: { type: DataTypes.TEXT('medium'), allowNull: true },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('draft', 'pending_review', 'scheduled', 'published', 'rejected', 'archived', 'private'),
        allowNull: false,
        defaultValue: 'draft',
    },
    slug: { type: DataTypes.STRING(160), allowNull: true, unique: true },
    excerpt: { type: DataTypes.STRING(320), allowNull: true },
    readingTime: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    scheduledAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.INTEGER, allowNull: true },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    rejectionReason: { type: DataTypes.STRING(500), allowNull: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: true },
    coverMediaId: { type: DataTypes.INTEGER, allowNull: true },
    coverAlt: { type: DataTypes.STRING(200), allowNull: true },
});

export default Post;
