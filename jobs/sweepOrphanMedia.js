import { ORPHAN_GRACE_HOURS, SWEEP_BATCH } from "../config/media.js";
import { findUnreferencedMedia, isMediaReferenced } from "../repositories/mediaRepository.js";
import { discardMedia } from "../services/mediaService.js";

const HOUR_MS = 60 * 60 * 1000;

// Cover and inline images are uploaded before the post that uses them is saved, and a post can later
// stop using them or be deleted. Images that no post uses and that are older than the grace period are
// removed (the row is marked deleted and the file is deleted from storage). Returns how many were removed.
//
// A recent upload is never touched: the writer may still be composing the post it belongs to. Images
// that only an old revision shows can be swept too; restoring that revision leaves them out.
export const sweepOrphanMedia = async ({ now = new Date() } = {}) => {
    const before = new Date(now.getTime() - ORPHAN_GRACE_HOURS * HOUR_MS);
    let removed = 0;

    for (;;) {
        const batch = await findUnreferencedMedia({ before, limit: SWEEP_BATCH });
        let progressed = 0;
        for (const media of batch) {
            // a post may have started using it since the list was read
            if (await isMediaReferenced(media.id)) continue;
            await discardMedia(media);
            progressed += 1;
        }
        removed += progressed;
        if (progressed === 0) break;
    }
    return removed;
};
