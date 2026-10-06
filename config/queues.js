// The jobs the app knows, and which queue each one runs on. Job data is always ids and numbers, never
// secrets or personal text: Redis keeps it until the job is done (and a while after).
export const QUEUE_OF = Object.freeze({
    notify: "notifications", // an event happened (a comment, a follow...): create the notifications
    "notification-email": "emails", // send the email for one notification
    "publish-scheduled": "maintenance",
    "sweep-media": "maintenance",
    "purge-analytics": "maintenance", // delete the day-by-day visitor codes once they are two days old
});

export const QUEUES = Object.freeze([...new Set(Object.values(QUEUE_OF))]);

// how a failed job is tried again (BullMQ and the in-process queue follow the same rules)
export const JOB_DEFAULTS = Object.freeze({ attempts: 5, backoffMs: 2000 });

// how many finished and failed jobs Redis keeps for inspection
export const KEEP_COMPLETED = 1000;
export const KEEP_FAILED = 5000;
