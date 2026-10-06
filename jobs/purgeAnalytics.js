import logger from "../config/logger.js";
import { purgeVisitors } from "../services/analyticsService.js";

// Once a day: delete the visitor codes that are older than the retention. They hold no personal data (they are
// one-way hashes that change daily), but there is no reason to keep them. The daily totals stay.
export const purgeAnalytics = async () => {
    const removed = await purgeVisitors();
    if (removed > 0) logger.info({ removed }, "Purged old analytics visitor codes");
    return removed;
};
