import { getDashboard, getUserDetail, listUsers, setUserRole, signOutEverywhere, suspendUser, unsuspendUser } from "../services/adminService.js";
import { userListQuerySchema } from "../schemas/adminSchemas.js";
import { requireValidId } from "../utils/ids.js";
import { ValidationError } from "../utils/AppError.js";
import { getAuditLogs } from "../services/auditService.js";
import { NotFoundError } from "../utils/AppError.js";
import { parsePagination } from "../utils/pagination.js";
import { requestContext } from "../utils/requestContext.js";
import { sendSuccess } from "../utils/response.js";

export const changeUserRole = async (req, res) => {
    if (!Number.isInteger(Number(req.params.id))) {
        throw new NotFoundError("User not found");
    }
    const user = await setUserRole(req.user, Number(req.params.id), req.body.role, requestContext(req));
    return sendSuccess(res, 200, { user });
};

export const listAuditLogs = async (req, res) => {
    const { page, limit } = parsePagination(req.query);
    const actorId = Number.parseInt(req.query.actorId, 10);
    const { logs, pagination } = await getAuditLogs({
        page,
        limit,
        action: typeof req.query.action === "string" ? req.query.action : undefined,
        entityType: typeof req.query.entityType === "string" ? req.query.entityType : undefined,
        entityId: typeof req.query.entityId === "string" && /^\d{1,12}$/.test(req.query.entityId) ? req.query.entityId : undefined,
        actorId: Number.isInteger(actorId) ? actorId : undefined,
    });
    return sendSuccess(res, 200, { logs }, { pagination });
};

export const getStats = async (req, res) => sendSuccess(res, 200, { stats: await getDashboard() });

export const getUsers = async (req, res) => {
    const parsed = userListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
    const { users, pagination } = await listUsers({ ...parsed.data, ...parsePagination(req.query) });
    return sendSuccess(res, 200, { users }, { pagination });
};

export const getUser = async (req, res) => sendSuccess(res, 200, { user: await getUserDetail(requireValidId(req.params.id, "User")) });

export const postSuspend = async (req, res) =>
    sendSuccess(res, 200, { user: await suspendUser(req.user, requireValidId(req.params.id, "User"), req.body.reason, requestContext(req)) });

export const postUnsuspend = async (req, res) =>
    sendSuccess(res, 200, { user: await unsuspendUser(req.user, requireValidId(req.params.id, "User"), requestContext(req)) });

export const postSignOut = async (req, res) =>
    sendSuccess(res, 200, await signOutEverywhere(req.user, requireValidId(req.params.id, "User"), requestContext(req)));
