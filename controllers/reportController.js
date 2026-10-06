import { createReport } from "../services/reportService.js";
import { sendSuccess } from "../utils/response.js";

export const postReport = async (req, res) => sendSuccess(res, 201, { report: await createReport(req.user, req.body) });
