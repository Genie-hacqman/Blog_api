import { findDueScheduledPosts, transitionPost } from "../repositories/postRepository.js";
import { findLatestRevision } from "../repositories/postRevisionRepository.js";
import { retryOnDeadlock, withTransaction } from "../database/transaction.js";
import { recordAudit } from "../services/auditService.js";
import { publishEvent } from "../services/notificationService.js";

const BATCH_SIZE = 100;

// Publish every scheduled post whose time has come. Safe to run from several app instances at
// once (each claims its own batch with SKIP LOCKED) and safe to run twice (a post that is no
// longer "scheduled" is not touched). Returns how many posts were published.
export const publishDuePosts = async (now = new Date()) => {
    let published = 0;
    for (;;) {
        // several workers can lock overlapping rows and deadlock; InnoDB kills one, which simply runs again
        const { count, ids } = await retryOnDeadlock(() => withTransaction(async (transaction) => {
            const due = await findDueScheduledPosts(now, BATCH_SIZE, transaction);
            const ids = [];
            for (const post of due) {
                const changed = await transitionPost(
                    post.id,
                    "scheduled",
                    // the time the author chose is the publication time, even if the job ran a little late
                    { status: "published", publishedAt: post.publishedAt ?? post.scheduledAt, scheduledAt: null },
                    { transaction },
                );
                if (changed === 0) continue;
                ids.push(post.id);
                const latest = await findLatestRevision(post.id, { transaction });
                await recordAudit(
                    {
                        actorId: null,
                        action: "post.published_on_schedule",
                        entityType: "post",
                        entityId: post.id,
                        metadata: { from: "scheduled", to: "published", scheduledFor: post.scheduledAt.toISOString(), revision: latest?.version ?? null },
                    },
                    { transaction },
                );
            }
            return { count: due.length, ids };
        }));
        published += count;
        // once it is committed, tell each author their story went live
        for (const id of ids) void publishEvent({ event: "post_published_on_schedule", postId: id, at: now.getTime() });
        if (count < BATCH_SIZE) return published;
    }
};
