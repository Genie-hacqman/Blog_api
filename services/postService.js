import { randomUUID } from "node:crypto";
import {
    createPost as createPostRecord,
    deletePostById,
    findPostById,
    findPostBySlug,
    findPostsByOwner,
    findPostsByStatus,
    findPublishedPage,
    lockPostById,
    slugExists,
    updatePostForOwner,
} from "../repositories/postRepository.js";
import { findCategoryBySlug } from "../repositories/categoryRepository.js";
import { findTagBySlug } from "../repositories/tagRepository.js";
import { isDeadlock, withTransaction } from "../database/transaction.js";
import { canDeletePost, canModifyPost, canViewPost, EDITABLE_STATUSES } from "../policies/postPolicy.js";
import { availableTransitions, evaluateTransition } from "../policies/postWorkflow.js";
import { roleHasPermission } from "../config/roles.js";
import { recordAudit } from "./auditService.js";
import { recordRevision } from "./postRevisionService.js";
import { ensureTags } from "./tagService.js";
import { attachPostData, attachViewerState } from "./engagementService.js";
import { categoryExists } from "./categoryService.js";
import { replacePostTags } from "../repositories/postTagRepository.js";
import { replacePostMedia } from "../repositories/postMediaRepository.js";
import { getStorage } from "../providers/storage/index.js";
import { prepareContent, resolveCover } from "./postContentService.js";
import { toAuthor } from "../utils/author.js";
import { isAutoSlug, slugify, withSuffix } from "../utils/slug.js";
import { autoExcerpt, readingTimeOf } from "../utils/text.js";
import { htmlToText } from "../utils/richText.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../utils/AppError.js";

// the section and the topics, as readers see them
const categoryOf = (post) => (post.category ? { id: post.category.id, name: post.category.name, slug: post.category.slug } : null);
const tagsOf = (post) => post.tagList ?? [];
// the cover image as readers get it (the alternative text is the author's description of it)
const coverOf = (post) =>
    post.cover
        ? { id: post.cover.id, url: getStorage().publicUrl(post.cover.key), width: post.cover.width, height: post.cover.height, alt: post.coverAlt ?? "" }
        : null;
// the readable text of a post; older rows that were never converted fall back to reading the HTML
const textOf = (post) => post.contentText ?? htmlToText(post.content);

const pagination = (page, limit, count) => ({ page, limit, total: count, totalPages: Math.ceil(count / limit) });

// What a viewer is told about one post. The author and reviewers also see why it was rejected,
// and every signed-in viewer is told which actions are open to them (so the UI never offers a
// button the server would refuse).
export const toPostDto = (post, viewer = null) => {
    const privileged = viewer && (post.userId === viewer.id || roleHasPermission(viewer.role, "post:review"));
    return {
        id: post.id,
        slug: post.slug,
        title: post.title,
        excerpt: post.excerpt ?? autoExcerpt(textOf(post)),
        content: post.content,
        cover: coverOf(post),
        readingTime: post.readingTime,
        status: post.status,
        publishedAt: post.publishedAt,
        scheduledAt: post.scheduledAt,
        author: toAuthor(post.author),
        category: categoryOf(post),
        tags: tagsOf(post),
        likeCount: post.likeCount ?? 0,
        commentCount: post.commentCount ?? 0,
        // what the signed-in viewer has done with it (only loaded for the detail pages)
        ...(viewer && { liked: post.liked ?? false, bookmarked: post.bookmarked ?? false }),
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        ...(privileged && { rejectionReason: post.rejectionReason ?? null, reviewedAt: post.reviewedAt ?? null }),
        actions: viewer ? availableTransitions(viewer, post) : [],
        canEdit: Boolean(viewer) && canModifyPost(viewer, post) && EDITABLE_STATUSES.has(post.status),
    };
};

// a teaser without the body
export const toPreview = (post) => ({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt ?? "",
    cover: coverOf(post),
    readingTime: post.readingTime,
    status: post.status,
    author: toAuthor(post.author),
    category: categoryOf(post),
    tags: tagsOf(post),
    likeCount: post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    publishedAt: post.publishedAt,
    scheduledAt: post.scheduledAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
});

// ---------- slugs ----------

const slugTaken = () => new AppError(409, "SLUG_TAKEN", "That URL is already used by another post");

// the first free "base", "base-2", "base-3" ... (or, when several requests keep colliding on the
// same numbers, "base-<random>")
const generateSlug = async (title, { excludeId, transaction, randomize = false } = {}) => {
    const base = slugify(title);
    if (randomize) return `${base}-${randomUUID().slice(0, 6)}`;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
        const candidate = withSuffix(base, attempt);
        if (!(await slugExists(candidate, { excludeId, transaction }))) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
};

const assertSlugFree = async (slug, options) => {
    if (await slugExists(slug, options)) throw slugTaken();
    return slug;
};

// Two requests can pick the same free slug at the same moment: the unique index rejects one (or
// InnoDB breaks a deadlock between them). The loser runs again, and from the second try on picks a
// random suffix so that a crowd of identical titles cannot keep colliding on "-2", "-3".
// `work` receives the attempt number.
const withSlugRetry = async (work) => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await work(attempt);
        } catch (error) {
            const slugCollision = error.name === "SequelizeUniqueConstraintError" && error.errors?.some((e) => String(e.path).includes("slug"));
            if (!(slugCollision || isDeadlock(error)) || attempt >= 5) throw error;
        }
    }
};

// ---------- create / read ----------

// a category id must name a category that exists (a clear message instead of a raw foreign-key error)
const assertCategory = async (categoryId) => {
    if (categoryId && !(await categoryExists(categoryId))) {
        throw new ValidationError("That category does not exist");
    }
};

export const createPost = async (user, { title, content, excerpt, slug, status = "draft", categoryId = null, tags = [], coverMediaId = null, coverAlt = null }, context) => {
    // publishing at creation is only for people who may publish without review
    if (status === "published") {
        const verdict = evaluateTransition(user, { status: "draft", userId: user.id }, "published");
        if (!verdict.ok) throw new AppError(verdict.status, verdict.code, verdict.message);
    }
    await assertCategory(categoryId);
    const prepared = await prepareContent(user, content);
    const coverId = await resolveCover(user, coverMediaId);
    const tagIds = await ensureTags(tags);

    const post = await withSlugRetry((attempt) =>
        withTransaction(async (transaction) => {
            const finalSlug = slug ? await assertSlugFree(slug, { transaction }) : await generateSlug(title, { transaction, randomize: attempt > 1 });
            const created = await createPostRecord(
                {
                    title,
                    content: prepared.content,
                    contentText: prepared.contentText,
                    userId: user.id,
                    status,
                    slug: finalSlug,
                    excerpt: excerpt ?? autoExcerpt(prepared.contentText),
                    readingTime: readingTimeOf(prepared.contentText),
                    publishedAt: status === "published" ? new Date() : null,
                    categoryId,
                    coverMediaId: coverId,
                    coverAlt: coverId ? coverAlt : null,
                },
                { transaction },
            );
            await replacePostTags(created.id, tagIds, { transaction });
            await replacePostMedia(created.id, prepared.mediaIds, { transaction });
            await recordRevision(created, user.id, "created", { transaction });
            if (status === "published") {
                await recordAudit(
                    { actorId: user.id, action: "post.status_changed", entityType: "post", entityId: created.id, metadata: { from: null, to: "published" } },
                    { context, transaction },
                );
            }
            return created;
        }),
    );
    await attachPostData([post]);
    return toPostDto(post, user);
};

// published posts as previews, paginated; pass userId to list one author's posts
// Optional filters name a section or topic by slug; one that does not exist is "not found" (so /category/nope is a 404 page).
export const getAllPosts = async ({ page, limit, userId, category, tag }) => {
    let categoryId;
    let tagId;
    if (category) {
        const found = await findCategoryBySlug(category);
        if (!found) throw new NotFoundError("Category not found");
        categoryId = found.id;
    }
    if (tag) {
        const found = await findTagBySlug(tag);
        if (!found) throw new NotFoundError("Tag not found");
        tagId = found.id;
    }
    const { rows, count } = await findPublishedPage({ userId, categoryId, tagId, limit, offset: (page - 1) * limit });
    await attachPostData(rows);
    return { posts: rows.map(toPreview), pagination: pagination(page, limit, count) };
};

// an author's own posts in every status (their dashboard)
export const listMyPosts = async (user, { status, page, limit }) => {
    const { rows, count } = await findPostsByOwner({ userId: user.id, status, limit, offset: (page - 1) * limit });
    await attachPostData(rows);
    return { posts: rows.map(toPreview), pagination: pagination(page, limit, count) };
};

// posts waiting for an editor, oldest first
export const listReviewQueue = async ({ page, limit }) => {
    const { rows, count } = await findPostsByStatus({ status: "pending_review", limit, offset: (page - 1) * limit });
    await attachPostData(rows);
    return { posts: rows.map(toPreview), pagination: pagination(page, limit, count) };
};

// Anything the viewer may not see is "not found", exactly like a missing post, so private
// drafts cannot be discovered by trying ids or slugs. `user` is null for anonymous visitors.
const visibleOrNotFound = (post, user) => {
    if (!post || !canViewPost(user, post)) {
        throw new NotFoundError("Post not found");
    }
    return post;
};

export const getPostById = async (id, user) => {
    const post = visibleOrNotFound(await findPostById(id), user);
    await attachPostData([post]);
    await attachViewerState(post, user);
    return toPostDto(post, user);
};

export const getPostBySlug = async (slug, user) => {
    const post = visibleOrNotFound(await findPostBySlug(slug), user);
    await attachPostData([post]);
    await attachViewerState(post, user);
    return toPostDto(post, user);
};

// ---------- edit / delete ----------

// Change a post's content, section or topics. Status changes go through postStatusService, never
// through here, so there is no way to publish by editing.
export const updatePost = async (id, user, data) => {
    const post = await withSlugRetry((attempt) =>
        withTransaction(async (transaction) => {
            const post = visibleOrNotFound(await lockPostById(id, transaction), user);
            if (!canModifyPost(user, post)) {
                throw new ForbiddenError("Not authorized to update this post");
            }
            if (!EDITABLE_STATUSES.has(post.status)) {
                throw new AppError(409, "POST_LOCKED", "Withdraw the post from review (or unschedule or unarchive it) before editing");
            }

            // Autosave: the writer's screen says which version it started from. If the post has been saved
            // since (another tab, another device), refuse instead of silently overwriting that work.
            if (data.expectedUpdatedAt && post.updatedAt.getTime() !== data.expectedUpdatedAt.getTime()) {
                throw new AppError(409, "EDIT_CONFLICT", "This post was changed somewhere else. Reload it before saving again.");
            }

            const changes = {};
            if (data.title !== undefined) changes.title = data.title;
            const title = changes.title ?? post.title;

            // the body is sanitized, and everything derived from it follows it
            const oldText = textOf(post);
            const prepared = data.content !== undefined ? await prepareContent(user, data.content) : null;
            if (prepared) {
                changes.content = prepared.content;
                changes.contentText = prepared.contentText;
            }
            const text = prepared?.contentText ?? oldText;

            // an excerpt that was never customized follows the content
            if (data.excerpt !== undefined) changes.excerpt = data.excerpt ?? autoExcerpt(text);
            else if (prepared && post.excerpt === autoExcerpt(oldText)) changes.excerpt = autoExcerpt(text);
            if (prepared) changes.readingTime = readingTimeOf(text);

            // the cover image, and its description (which only exists while there is a cover)
            if (data.coverMediaId !== undefined) changes.coverMediaId = await resolveCover(user, data.coverMediaId);
            const coverAfter = changes.coverMediaId !== undefined ? changes.coverMediaId : post.coverMediaId;
            if (!coverAfter) changes.coverAlt = null;
            else if (data.coverAlt !== undefined) changes.coverAlt = data.coverAlt;

            // the URL is chosen by the author, or follows the title until the first publication; then it is frozen
            if (data.slug !== undefined && data.slug !== post.slug) {
                if (post.publishedAt) throw new AppError(409, "SLUG_LOCKED", "The URL of a post that has been published cannot change");
                changes.slug = await assertSlugFree(data.slug, { excludeId: id, transaction });
            } else if (data.slug === undefined && changes.title !== undefined && !post.publishedAt && isAutoSlug(post.slug, post.title)) {
                changes.slug = await generateSlug(title, { excludeId: id, transaction, randomize: attempt > 1 });
            }

            if (data.categoryId !== undefined) {
                await assertCategory(data.categoryId);
                changes.categoryId = data.categoryId;
            }
            // topics are shared vocabulary, created outside this transaction (see ensureTags), then attached to this post
            const tagIds = data.tags !== undefined ? await ensureTags(data.tags) : undefined;

            // values that are already stored are not changes: saving the same thing again (autosave does it
            // constantly) must not touch the post or make it look edited
            for (const key of Object.keys(changes)) {
                if (changes[key] === post[key]) delete changes[key];
            }

            // nothing to change (the same values sent again): that is a success, not a "not found"
            if (Object.keys(changes).length === 0 && tagIds === undefined && !prepared) {
                return findPostById(id, { transaction });
            }

            // the owner is part of the write condition, so ownership cannot change between the check and the write
            if (Object.keys(changes).length > 0 && (await updatePostForOwner(id, user.id, changes, { transaction })) === 0) {
                throw new NotFoundError("Post not found");
            }
            if (tagIds !== undefined) {
                await replacePostTags(id, tagIds, { transaction });
            }
            if (prepared) {
                await replacePostMedia(id, prepared.mediaIds, { transaction });
            }
            const fresh = await findPostById(id, { transaction });
            await recordRevision(fresh, user.id, "edited", { transaction });
            return fresh;
        }),
    );
    // the tags are read after the commit: they are loaded on their own connection, which cannot see a
    // change the transaction has not committed yet
    await attachPostData([post]);
    return toPostDto(post, user);
};

// delete a post, only if the requesting user is the author
export const deletePost = async (id, user) => {
    const post = visibleOrNotFound(await findPostById(id), user);
    if (!canDeletePost(user, post)) {
        throw new ForbiddenError("Not authorized to delete this post");
    }
    if ((await deletePostById(id, user.id)) === 0) {
        throw new NotFoundError("Post not found");
    }
};
