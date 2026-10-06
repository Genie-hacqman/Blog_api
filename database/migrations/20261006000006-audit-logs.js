import { DataTypes } from "sequelize";

// Append-only record of security-relevant actions. actorId is nullable (system actions,
// and kept if the actor is ever removed).
export const up = async ({ context: queryInterface }) => {
    await queryInterface.createTable("audit_logs", {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        actorId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: "Users", key: "id" },
            onDelete: "SET NULL",
            onUpdate: "CASCADE",
        },
        action: { type: DataTypes.STRING(64), allowNull: false },
        entityType: { type: DataTypes.STRING(32), allowNull: false },
        entityId: { type: DataTypes.STRING(64), allowNull: true },
        metadata: { type: DataTypes.JSON, allowNull: true },
        ip: { type: DataTypes.STRING(45), allowNull: true },
        userAgent: { type: DataTypes.STRING(255), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex("audit_logs", ["actorId", "createdAt"], { name: "idx_audit_actor_created" });
    await queryInterface.addIndex("audit_logs", ["entityType", "entityId"], { name: "idx_audit_entity" });
    await queryInterface.addIndex("audit_logs", ["action", "createdAt"], { name: "idx_audit_action_created" });
};

export const down = async ({ context: queryInterface }) => {
    await queryInterface.dropTable("audit_logs");
};
