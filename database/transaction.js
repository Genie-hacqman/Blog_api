import sequelize from "./dbconnection.js";

// Run `work(transaction)` atomically: commits when it resolves, rolls back when it throws.
// Services use this instead of importing the Sequelize instance; repositories take the
// transaction through their `options` argument.
export const withTransaction = (work) => sequelize.transaction(work);

// InnoDB resolves a deadlock by killing one of the two transactions; the right response is to run it again.
export const isDeadlock = (error) => error?.parent?.code === "ER_LOCK_DEADLOCK" || error?.original?.code === "ER_LOCK_DEADLOCK";

export const retryOnDeadlock = async (work, attempts = 3) => {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await work();
        } catch (error) {
            if (!isDeadlock(error) || attempt >= attempts) throw error;
        }
    }
};
