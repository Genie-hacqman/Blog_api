// Small "does it exist yet?" checks for migrations. MySQL cannot roll back DDL, so a migration
// that is interrupted half way leaves the schema half changed; a migration that checks before it
// adds can simply be run again and finishes the job.

export const tableExists = async (queryInterface, table) =>
    (await queryInterface.showAllTables()).some((entry) => (typeof entry === "string" ? entry : entry.tableName) === table);

export const hasColumn = async (queryInterface, table, column) => column in (await queryInterface.describeTable(table));

export const hasIndex = async (queryInterface, table, name) =>
    (await queryInterface.showIndex(table)).some((index) => index.name === name);

export const hasConstraint = async (queryInterface, table, name) => {
    const [rows] = await queryInterface.sequelize.query(
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = :table AND CONSTRAINT_NAME = :name",
        { replacements: { table, name } },
    );
    return rows.length > 0;
};

export const addColumnIfMissing = async (queryInterface, table, column, definition) => {
    if (!(await hasColumn(queryInterface, table, column))) {
        await queryInterface.addColumn(table, column, definition);
    }
};

export const addIndexIfMissing = async (queryInterface, table, fields, options) => {
    if (!(await hasIndex(queryInterface, table, options.name))) {
        await queryInterface.addIndex(table, fields, options);
    }
};

export const addConstraintIfMissing = async (queryInterface, table, options) => {
    if (!(await hasConstraint(queryInterface, table, options.name))) {
        await queryInterface.addConstraint(table, options);
    }
};
