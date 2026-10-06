import { getHealth } from "../services/healthService.js";
import { sendSuccess } from "../utils/response.js";

// 200 when everything the app depends on is reachable, 503 otherwise
export const checkHealth = async (req, res) => {
    const health = await getHealth();
    if (health.status !== "ok") {
        return res.status(503).json({
            success: false,
            error: { code: "SERVICE_UNAVAILABLE", message: "Service is degraded", details: health },
        });
    }
    return sendSuccess(res, 200, health);
};
