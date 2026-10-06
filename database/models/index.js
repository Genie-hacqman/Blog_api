import User from './userModel.js';
import Post from './postModel.js';
import RefreshToken from './refreshTokenModel.js';
import UserToken from './userTokenModel.js';
import AuditLog from './auditLogModel.js';
import Media from './mediaModel.js';
import PostRevision from './postRevisionModel.js';
import Category from './categoryModel.js';
import Tag from './tagModel.js';
import PostTag from './postTagModel.js';
import PostMedia from './postMediaModel.js';
import Comment from './commentModel.js';
import PostLike from './postLikeModel.js';
import Bookmark from './bookmarkModel.js';
import Follow from './followModel.js';
import Notification from './notificationModel.js';
import NotificationPreference from './notificationPreferenceModel.js';
import Report from './reportModel.js';
import PostDailyStats from './postDailyStatsModel.js';
import PostVisitor from './postVisitorModel.js';
import PostReferrer from './postReferrerModel.js';

// associate posts with the user that authored them (backed by the fk_posts_user foreign key)
User.hasMany(Post, { foreignKey: 'userId', as: 'posts', onDelete: 'RESTRICT' });
Post.belongsTo(User, { foreignKey: 'userId', as: 'author' });

Post.hasMany(PostRevision, { foreignKey: 'postId', as: 'revisions', onDelete: 'CASCADE' });
PostRevision.belongsTo(Post, { foreignKey: 'postId' });
PostRevision.belongsTo(User, { foreignKey: 'createdBy', as: 'editor' });
Post.belongsTo(User, { foreignKey: 'reviewedBy', as: 'reviewer' });

Post.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });
Category.hasMany(Post, { foreignKey: 'categoryId', as: 'posts' });
PostTag.belongsTo(Tag, { foreignKey: 'tagId', as: 'tag' });
Post.hasMany(PostTag, { foreignKey: 'postId', as: 'postTags', onDelete: 'CASCADE' });
Tag.hasMany(PostTag, { foreignKey: 'tagId', as: 'postTags', onDelete: 'CASCADE' });

// a post's cover image (backed by the fk_posts_cover foreign key) and the inline images it uses
Post.belongsTo(Media, { foreignKey: 'coverMediaId', as: 'cover', constraints: false });
PostMedia.belongsTo(Media, { foreignKey: 'mediaId', as: 'media' });
Post.hasMany(PostMedia, { foreignKey: 'postId', as: 'postMedia', onDelete: 'CASCADE' });

// comments, one level of replies
Post.hasMany(Comment, { foreignKey: 'postId', as: 'comments', onDelete: 'CASCADE' });
Comment.belongsTo(Post, { foreignKey: 'postId', as: 'post' });
Comment.belongsTo(User, { foreignKey: 'userId', as: 'author' });
Comment.belongsTo(Comment, { foreignKey: 'parentId', as: 'parent' });
Comment.hasMany(Comment, { foreignKey: 'parentId', as: 'replies' });

// likes, bookmarks and follows (link tables; their rows are removed with the post, or by account deletion)
PostLike.belongsTo(Post, { foreignKey: 'postId', as: 'post' });
Bookmark.belongsTo(Post, { foreignKey: 'postId', as: 'post' });
Follow.belongsTo(User, { foreignKey: 'followerId', as: 'follower' });
Follow.belongsTo(User, { foreignKey: 'followingId', as: 'following' });

Report.belongsTo(User, { foreignKey: 'reporterId', as: 'reporter' });
Report.belongsTo(User, { foreignKey: 'handledBy', as: 'handler' });

User.hasMany(RefreshToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
RefreshToken.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(UserToken, { foreignKey: 'userId', onDelete: 'CASCADE' });
UserToken.belongsTo(User, { foreignKey: 'userId' });

AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

User.hasMany(Media, { foreignKey: 'ownerId', onDelete: 'CASCADE' });
Media.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });
// the user's current profile photo (backed by the fk_users_avatar foreign key)
User.belongsTo(Media, { foreignKey: 'avatarMediaId', as: 'avatar', constraints: false });

export { User, Post, PostRevision, RefreshToken, UserToken, AuditLog, Media, Category, Tag, PostTag, PostMedia, Comment, PostLike, Bookmark, Follow, Notification, NotificationPreference, Report, PostDailyStats, PostVisitor, PostReferrer };
