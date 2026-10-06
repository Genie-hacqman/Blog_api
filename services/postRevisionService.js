import { diffLines } from "diff";
import {
    createRevision,
    findLatestRevision,
    findRevision,
    findRevisions,
    trimRevisions,
    updateRevision,
} from "../repositories/postRevisionRepository.js";
import { lockPostById, findPostById, updatePostForOwner } from "../repositories/postRepository.js";
import { withTransaction } from "../database/transaction.js";
import { canViewPost, canViewRevisions, canModifyPost, EDITABLE_STATUSES } from "../policies/postPolicy.js";
import { recordAudit } from "./auditService.js";
import { MAX_REVISIONS_PER_POST, REVISION_COALESCE_MS } from "../config/posts.js";
import { autoExcerpt, readingTimeOf } from "../utils/text.js";
import { htmlToDiffText } from "../utils/richText.js";
import { replacePostMedia } from "../repositories/postMediaRepository.js";
import { prepareContent } from "./postContentService.js";
import { AppError, NotFoundError, ValidationError } from "../utils/AppError.js";

const sameContent = (revision, post) =>
    revision.title === post.title && (revision.excerpt ?? null) === (post.excerpt ?? null) && revision.content === post.content;

// work in progress is merged: a burst of saves by the same person on an unpublished post updates
// the newest revision instead of piling up dozens of near-identical ones
const UNPUBLISHED = new Set(["draft", "rejected", "private"]);

// Save the post's current title/excerpt/content as a revision. Call it, inside the transaction that
// changed the post, after every change to those fields. Returns the revision, or the existing
// one when nothing changed.
export const recordRevision = async (post, actorId, reason, { transaction }) => {
    const latest = await findLatestRevision(post.id, { transaction });
    const snapshot = { title: post.title, excerpt: post.excerpt ?? null, content: post.content };

    if (latest && sameContent(latest, post)) {
        return latest;
    }

    const recent = latest && Date.now() - latest.createdAt.getTime() < REVISION_COALESCE_MS;
    if (recent && reason === "edited" && latest.reason !== "restored" && latest.createdBy === actorId && UNPUBLISHED.has(post.status)) {
        await updateRevision(latest.id, snapshot, { transaction });
        return { ...latest.get(), ...snapshot };
    }

    const revision = await createRevision(
        { postId: post.id, version: (latest?.version ?? 0) + 1, createdBy: actorId, reason, ...snapshot },
        { transaction },
    );
    await trimRevisions(post.id, MAX_REVISIONS_PER_POST, { transaction });
    return revision;
};

const toMeta = (revision) => ({
    version: revision.version,
    title: revision.title,
    excerpt: revision.excerpt ?? null,
    reason: revision.reason,
    editor: revision.editor ? { id: revision.editor.id, username: revision.editor.username } : null,
    createdAt: revision.createdAt,
});

const toDetail = (revision) => ({ ...toMeta(revision), content: revision.content });

// the post, if this user may see its history; otherwise "not found" (a hidden draft must not be probed)
const loadForHistory = async (id, user) => {
    const post = await findPostById(id);
    if (!post || !canViewPost(user, post) || !canViewRevisions(user, post)) {
        throw new NotFoundError("Post not found");
    }
    return post;
};

export const listRevisions = async (id, user, { page, limit }) => {
    const post = await loadForHistory(id, user);
    const { rows, count } = await findRevisions({ postId: post.id, limit, offset: (page - 1) * limit });
    return {
        revisions: rows.map(toMeta),
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
};

export const getRevision = async (id, version, user) => {
    const post = await loadForHistory(id, user);
    const revision = await findRevision(post.id, version);
    if (!revision) throw new NotFoundError("Revision not found");
    return toDetail(revision);
};

// Compare two versions line by line. `to` may be "current" (the post as it is now).
export const compareRevisions = async (id, user, from, to) => {
    const post = await loadForHistory(id, user);
    const older = await findRevision(post.id, from);
    if (!older) throw new NotFoundError("Revision not found");

    let newer;
    if (to === "current") {
        newer = { version: null, title: post.title, excerpt: post.excerpt ?? null, content: post.content, reason: "current", editor: null, createdAt: post.updatedAt };
    } else {
        newer = await findRevision(post.id, to);
        if (!newer) throw new NotFoundError("Revision not found");
    }

    // a last line without a newline would otherwise count as changed when only a line was added after it
    const terminated = (text) => (text.endsWith("\n") ? text : `${text}\n`);
    // content is HTML, so the comparison is made on its readable form: one line per paragraph, heading or list item
    const parts = diffLines(terminated(htmlToDiffText(older.content)), terminated(htmlToDiffText(newer.content))).map((part) => ({
        type: part.added ? "add" : part.removed ? "remove" : "same",
        value: part.value,
    }));

    return {
        from: toMeta(older),
        to: toMeta(newer),
        title: { changed: older.title !== newer.title, from: older.title, to: newer.title },
        excerpt: { changed: (older.excerpt ?? null) !== (newer.excerpt ?? null), from: older.excerpt ?? null, to: newer.excerpt ?? null },
        content: parts,
        stats: {
            added: parts.filter((p) => p.type === "add").reduce((n, p) => n + p.value.split("\n").filter(Boolean).length, 0),
            removed: parts.filter((p) => p.type === "remove").reduce((n, p) => n + p.value.split("\n").filter(Boolean).length, 0),
        },
    };
};

// Put an earlier version back. It becomes a new revision (history is never rewritten), and only
// the author can do it, under the same rules as any edit.
export const restoreRevision = async (id, version, user, context) => {
    return withTransaction(async (transaction) => {
        const post = await lockPostById(id, transaction);
        if (!post || !canViewPost(user, post) || !canViewRevisions(user, post)) {
            throw new NotFoundError("Post not found");
        }
        if (!canModifyPost(user, post)) {
            throw new AppError(403, "FORBIDDEN", "Only the author can restore a revision");
        }
        if (!EDITABLE_STATUSES.has(post.status)) {
            throw new AppError(409, "POST_LOCKED", "Withdraw the post from review before changing it");
        }

        const revision = await findRevision(post.id, version, { transaction });
        if (!revision) throw new NotFoundError("Revision not found");
        if (revision.content === post.content && revision.title === post.title) {
            throw new ValidationError("That revision is already the current version");
        }

        // an old version is sanitized again (the rules may be stricter now), and an image that has since been
        // deleted is left out of it instead of coming back as a broken picture
        const prepared = await prepareContent(user, revision.content, { strictImages: false });
        const restored = {
            title: revision.title,
            content: prepared.content,
            contentText: prepared.contentText,
            excerpt: revision.excerpt ?? autoExcerpt(prepared.contentText),
            readingTime: readingTimeOf(prepared.contentText),
        };
        await updatePostForOwner(post.id, user.id, restored, { transaction });
        await replacePostMedia(post.id, prepared.mediaIds, { transaction });
        const created = await recordRevision({ ...post.get(), ...restored }, user.id, "restored", { transaction });
        await recordAudit(
            { actorId: user.id, action: "post.revision_restored", entityType: "post", entityId: post.id, metadata: { restoredVersion: version, newVersion: created.version } },
            { context, transaction },
        );
        return created.version;
    });
};
