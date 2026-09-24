import User from './userModel.js';
import Post from './postModel.js';

// associate posts with the user that authored them
User.hasMany(Post, { foreignKey: 'userId', as: 'posts', constraints: false });
Post.belongsTo(User, { foreignKey: 'userId', as: 'author', constraints: false });

export { User, Post };
