import { getReportDetail, listQueue, resolveReport } from "../services/reportService.js";
import { requireValidId } from "../utils/ids.js";
import { parsePagination } from "../utils/pagination.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

export const getQueue = async (req, res) => {
    const status = req.query.status === "resolved" ? "resolved" : "open";
    const type = ["post", "comment", "user"].includes(req.query.type) ? req.query.type : undefined;
    const { items, pagination } = await listQueue(req.user, { status, type, ...parsePagination(req.query) });
    return sendSuccess(res, 200, { reports: items }, { pagination });
};

export const getReport = async (req, res) => sendSuccess(res, 200, { report: await getReportDetail(req.user, requireValidId(req.params.id, "Report")) });

export const postResolve = async (req, res) => {
    const report = await resolveReport(req.user, requireValidId(req.params.id, "Report"), req.body, requestContext(req));
    return sendSuccess(res, 200, { report });
};
