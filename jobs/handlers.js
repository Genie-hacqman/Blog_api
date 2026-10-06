import { handleEmail, handleEvent } from "../services/notificationService.js";
import { publishDuePosts } from "./publishScheduled.js";
import { purgeAnalytics } from "./purgeAnalytics.js";
import { sweepOrphanMedia } from "./sweepOrphanMedia.js";

// What each job name does. The queue (inline or BullMQ) calls these with the job's data; notification
// jobs are added here by the notification service.
export const handlers = {
    notify: (event) => handleEvent(event),
    "notification-email": (job) => handleEmail(job),
    "publish-scheduled": () => publishDuePosts(),
    "sweep-media": () => sweepOrphanMedia(),
    "purge-analytics": () => purgeAnalytics(),
};
