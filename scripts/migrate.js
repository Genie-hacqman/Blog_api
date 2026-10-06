// usage: node scripts/migrate.js <up|down|status>
import sequelize from "../database/dbconnection.js";
import { migrator } from "../database/migrator.js";

const command = process.argv[2] ?? "up";

try {
    if (command === "up") {
        const applied = await migrator.up();
        console.log(applied.length ? `Applied: ${applied.map((m) => m.name).join(", ")}` : "Already up to date.");
    } else if (command === "down") {
        const reverted = await migrator.down();
        console.log(reverted.length ? `Reverted: ${reverted.map((m) => m.name).join(", ")}` : "Nothing to revert.");
    } else if (command === "status") {
        const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
        executed.forEach((m) => console.log(`up       ${m.name}`));
        pending.forEach((m) => console.log(`pending  ${m.name}`));
    } else {
        console.error(`Unknown command "${command}". Use up, down or status.`);
        process.exitCode = 1;
    }
} catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
} finally {
    await sequelize.close();
}
