import http from "node:http";
import supertest from "supertest";
import sequelize from "../database/dbconnection.js";
import { migrator } from "../database/migrator.js";
import { User } from "../database/models/index.js";
import { clearSentEmails } from "../providers/email/memory.js";
import app from "../app.js";
import { getQueue } from "../providers/queue/index.js";
import { whenAnalyticsIdle } from "../services/analyticsService.js";

// Events (a comment, a follow...) are handled by background jobs. Wait for them before a test touches the
// database in bulk or ends, so a job never runs against a table that was just emptied or a closed connection.
export const settleJobs = async () => {
    await getQueue().idle();
    await whenAnalyticsIdle();
};

// By default supertest starts a brand-new HTTP server on a random port for every single request and
// tears it down again. Across hundreds of requests that churn occasionally left a client connected to
// a server that never accepted it, and the test waited for an answer that never came (a hang after a
// quick request, with no database activity at all). So the whole test file shares ONE server, started on
// first use and closed in closeDatabase(), and every request goes to it.
let sharedServer;
const server = () => {
    sharedServer ??= http.createServer(app).listen(0);
    return sharedServer;
};
export const request = (target) => supertest(target === app ? server() : target);

// Builds the schema from migrations (a no-op once applied) and empties every table,
// so tests exercise the same schema production runs.
export const resetDatabase = async () => {
    // this empties tables, so refuse to run anywhere but a local test database: .env may point at real data
    if (!["localhost", "127.0.0.1"].includes(process.env.DB_HOST)) {
        throw new Error(
            `Refusing to reset database on "${process.env.DB_HOST}". Run tests against a local MySQL, e.g. ` +
                "DB_HOST=localhost DB_PORT=3306 DB_USER=root DB_PASSWORD=<local password> npm test",
        );
    }
    if (!/test/i.test(process.env.DB_NAME ?? "")) {
        throw new Error(
            `Refusing to reset database "${process.env.DB_NAME}": its name must contain "test". Use \`npm test\`, which sets DB_NAME=blog_db_test.`,
        );
    }

    await settleJobs();
    await migrator.up();
    clearSentEmails();

    const queryInterface = sequelize.getQueryInterface();
    const tables = (await queryInterface.showAllTables())
        .map((table) => (typeof table === "string" ? table : table.tableName))
        .filter((table) => table !== "SequelizeMeta");

    // foreign key checks are per connection, so the toggle and the truncates must share one
    await sequelize.transaction(async (transaction) => {
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 0", { transaction });
        for (const table of tables) {
            await sequelize.query(`TRUNCATE TABLE \`${table}\``, { transaction });
        }
        await sequelize.query("SET FOREIGN_KEY_CHECKS = 1", { transaction });
    });
};

export const closeDatabase = async () => {
    await settleJobs();
    await new Promise((resolve) => (sharedServer ? sharedServer.close(resolve) : resolve()));
    sharedServer = undefined;
    await sequelize.close();
};

let userCount = 0;

// Every call needs the header the cookie-guarded endpoints demand
export const COOKIE_HEADERS = { "X-Requested-With": "fetch" };

// the name=value part of the refresh cookie from a Set-Cookie header, ready to send back
export const refreshCookieFrom = (response) => {
    const raw = (response.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith("refresh_token="));
    return raw ? raw.split(";")[0] : null;
};

// Registers an account, then applies `role` and `verified` directly in the database (the API
// deliberately offers no way to skip verification or pick a role) and logs in.
// Defaults to a verified author, which is what most tests need. Pass { role: "user" } or
// { verified: false } for the other cases.
export const registerAndLogin = async ({ role = "author", verified = true, ...overrides } = {}) => {
    userCount += 1;
    const credentials = {
        firstName: "Test",
        lastName: "User",
        userName: `testuser${userCount}`,
        email: `testuser${userCount}@example.com`,
        password: "password123",
        ...overrides,
    };

    await request(app).post("/api/auth/register").send(credentials);
    await User.update({ role, emailVerifiedAt: verified ? new Date() : null }, { where: { email: credentials.email } });

    const response = await request(app)
        .post("/api/auth/login")
        .send({ email: credentials.email, password: credentials.password });

    return {
        user: response.body.data.user,
        token: response.body.data.accessToken,
        cookie: refreshCookieFrom(response),
        credentials,
    };
};

export { app };
