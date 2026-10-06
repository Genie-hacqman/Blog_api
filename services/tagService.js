import {
    countPostsWithTag,
    countPublishedPostsWithTag,
    createTag,
    deleteTagById,
    findTagById,
    findTagBySlug,
    findTagsBySlugs,
    listPopularTags,
    renameTagById,
} from "../repositories/tagRepository.js";
import { findTagsForPosts, replacePostTags } from "../repositories/postTagRepository.js";
import { withTransaction } from "../database/transaction.js";
import { recordAudit } from "./auditService.js";
import { TAG_LIST_MAX } from "../config/taxonomy.js";
import { prepareTags } from "../utils/taxonomy.js";
import { ConflictError, NotFoundError } from "../utils/AppError.js";

const toTag = (tag, postCount) => ({ id: tag.id, name: tag.name, slug: tag.slug, ...(postCount !== undefined && { postCount }) });

// Put each post's tags on the post object (post.tagList) with one query for the whole page, so a list of
// ten posts does not cost ten extra queries. Returns the same posts for chaining.
export const attachTags = async (posts) => {
    const byPost = await findTagsForPosts(posts.map((post) => post.id));
    for (const post of posts) post.tagList = byPost.get(post.id) ?? [];
    return posts;
};

// Find or create the tags for these names and return their ids.
//
// Deliberately NOT part of the caller's transaction: tags are shared vocabulary, so a tag another
// author created a moment ago must be visible here, and a transaction's snapshot would hide it.
// A tag that was created for a post that then fails is harmless (empty tags are never listed).
// New tags are created in slug order so two requests creating the same pair cannot deadlock, and
// a lost race on the unique slug simply uses the row the winner made.
export const ensureTags = async (names) => {
    const wanted = prepareTags(names);
    if (wanted.length === 0) return [];

    const existing = new Map((await findTagsBySlugs(wanted.map((tag) => tag.slug))).map((tag) => [tag.slug, tag]));
    for (const { name, slug } of [...wanted].sort((a, b) => a.slug.localeCompare(b.slug))) {
        if (existing.has(slug)) continue;
        try {
            existing.set(slug, await createTag({ name, slug }));
        } catch (error) {
            if (error.name !== "SequelizeUniqueConstraintError") throw error;
            existing.set(slug, await findTagBySlug(slug));
        }
    }
    return wanted.map(({ slug }) => existing.get(slug).id);
};

// give a post exactly these tags
export const setPostTags = async (postId, names, options = {}) => replacePostTags(postId, await ensureTags(names), options);

// ---------- public ----------

export const listTags = async ({ prefix, limit }) => {
    const rows = await listPopularTags({ prefix: prefix?.trim() || null, limit: Math.min(limit, TAG_LIST_MAX) });
    return rows.map((row) => toTag(row, Number(row.postCount)));
};

// a tag no published post uses is not public: it is "not found" like one that never existed
export const getTag = async (slug) => {
    const tag = await findTagBySlug(slug);
    const postCount = tag ? await countPublishedPostsWithTag(tag.id) : 0;
    if (!tag || postCount === 0) throw new NotFoundError("Tag not found");
    return toTag(tag, postCount);
};

// ---------- editors ----------

// Rename the display name. The slug (the tag's address) stays, so links keep working.
export const renameTag = async (actor, id, name, context) => {
    const [prepared] = prepareTags([name]);
    return withTransaction(async (transaction) => {
        const tag = await findTagById(id, { transaction });
        if (!tag) throw new NotFoundError("Tag not found");

        const clash = await findTagBySlug(prepared.slug, { transaction });
        if (clash && clash.id !== tag.id) {
            throw new ConflictError("Another tag already uses that name");
        }

        await renameTagById(tag.id, prepared.name, { transaction });
        await recordAudit(
            { actorId: actor.id, action: "tag.renamed", entityType: "tag", entityId: tag.id, metadata: { from: tag.name, to: prepared.name } },
            { context, transaction },
        );
        return toTag({ ...tag.get(), name: prepared.name });
    });
};

// Remove a tag from every post that has it. The posts themselves are untouched.
export const deleteTag = async (actor, id, context) => {
    await withTransaction(async (transaction) => {
        const tag = await findTagById(id, { transaction });
        if (!tag) throw new NotFoundError("Tag not found");

        const posts = await countPostsWithTag(tag.id, { transaction });
        await deleteTagById(tag.id, { transaction });
        await recordAudit(
            { actorId: actor.id, action: "tag.deleted", entityType: "tag", entityId: tag.id, metadata: { name: tag.name, posts } },
            { context, transaction },
        );
    });
};
