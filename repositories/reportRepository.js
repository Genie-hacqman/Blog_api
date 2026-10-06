import { Op, QueryTypes } from "sequelize";
import sequelize from "../database/dbconnection.js";
import { Report, User } from "../database/models/index.js";

export const createReport = async (data) => Report.create(data);

export const findReportById = async (id, options = {}) => Report.findByPk(id, options);

export const countReportsBySince = async (reporterId, since) => Report.count({ where: { reporterId, createdAt: { [Op.gte]: since } } });

// the open reports about one target (newest first), with who filed them: for a moderator's eyes only
export const findReportsOfTarget = async (targetKey, statuses) =>
    Report.findAll({
        where: { targetKey, status: statuses },
        include: [{ model: User, as: "reporter", attributes: ["id", "username"] }],
        order: [["id", "DESC"]],
    });

// Group reports by what they are about. A page of { id (the newest report), targetKey, reportCount, lastReportedAt }
// and how many targets there are in all. Only the given statuses and kinds of target are looked at.
export const findGroupedPage = async ({ statuses, types, limit, offset }) => {
    const replacements = { statuses, types, limit, offset };
    const [rows, [{ total }]] = await Promise.all([
        sequelize.query(
            "SELECT MAX(id) AS id, targetKey, COUNT(*) AS reportCount, MAX(createdAt) AS lastReportedAt FROM `reports` " +
                "WHERE status IN (:statuses) AND targetType IN (:types) GROUP BY targetKey ORDER BY MAX(id) DESC LIMIT :limit OFFSET :offset",
            { replacements, type: QueryTypes.SELECT },
        ),
        sequelize.query(
            "SELECT COUNT(DISTINCT targetKey) AS total FROM `reports` WHERE status IN (:statuses) AND targetType IN (:types)",
            { replacements, type: QueryTypes.SELECT },
        ),
    ]);
    return { rows, total: Number(total) };
};

// the reasons given for many targets, in one query: Map(targetKey -> [{ reason, count }])
export const countReasonsFor = async (targetKeys, statuses) => {
    const byTarget = new Map();
    if (targetKeys.length === 0) return byTarget;
    const rows = await sequelize.query(
        "SELECT targetKey, reason, COUNT(*) AS n FROM `reports` WHERE targetKey IN (:targetKeys) AND status IN (:statuses) GROUP BY targetKey, reason ORDER BY n DESC",
        { replacements: { targetKeys, statuses }, type: QueryTypes.SELECT },
    );
    for (const row of rows) {
        if (!byTarget.has(row.targetKey)) byTarget.set(row.targetKey, []);
        byTarget.get(row.targetKey).push({ reason: row.reason, count: Number(row.n) });
    }
    return byTarget;
};

// how each resolved target ended, in one query: Map(targetKey -> the report that was handled last)
export const findLastHandledFor = async (targetKeys) => {
    const byTarget = new Map();
    if (targetKeys.length === 0) return byTarget;
    const rows = await Report.findAll({
        where: { targetKey: targetKeys, status: ["dismissed", "actioned"] },
        include: [{ model: User, as: "handler", attributes: ["id", "username"] }],
        order: [["handledAt", "DESC"], ["id", "DESC"]],
    });
    for (const row of rows) if (!byTarget.has(row.targetKey)) byTarget.set(row.targetKey, row);
    return byTarget;
};

// Close every open report about a target in one go: one decision, however many people reported it.
export const resolveOpenReports = async (targetKey, { status, handledBy, note }, options = {}) => {
    const [count] = await Report.update(
        { status, handledBy, handledAt: new Date(), resolutionNote: note ?? null },
        { where: { targetKey, status: "open" }, ...options },
    );
    return count;
};

export const countOpenTargets = async (types) => {
    const [{ total }] = await sequelize.query(
        "SELECT COUNT(DISTINCT targetKey) AS total FROM `reports` WHERE status = 'open' AND targetType IN (:types)",
        { replacements: { types }, type: QueryTypes.SELECT },
    );
    return Number(total);
};

export const countOpenReportsAbout = async (targetUserId) => Report.count({ where: { targetUserId, status: "open" } });
