import { DataTypes, QueryTypes } from "sequelize";
import { addColumnIfMissing, addConstraintIfMissing, addIndexIfMissing, hasIndex } from "../migrationHelpers.js";

// Migrations are frozen snapshots, so the helpers used for the backfill are copied here instead
// of imported: changing utils/slug.js later must not change what this migration did.
const slugify = (text) => {
    const slug = String(text ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 92)
        .replace(/-+$/g, "");
    return slug || "post";
};
// with its ellipsis the excerpt must still fit the VARCHAR(320) column
const autoExcerpt = (content) => {
    const text = String(content ?? "").trim();
    return text.length > 320 ? `${text.slice(0, 319).trimEnd()}…` : text;
};
const readingTimeOf = (content) => Math.max(1, Math.round(String(content ?? "").trim().split(/\s+/).filter(Boolean).length / 225));

const STATUSES = ["draft", "pending_review", "scheduled", "published", "rejected", "archived", "private"];

// Full status set, URL slugs, stored excerpt/reading time, publish and review bookkeeping.
//
// MySQL cannot roll back schema changes, so this migration is written to be run again after an
// interruption: every step first checks whether it was already done, and the backfill only
// touches posts that have not been given a slug yet.
export const up = async ({ context: queryInterface }) => {
    await queryInterface.changeColumn("Posts", "status", {
        type: DataTypes.ENUM(...STATUSES),
        allowNull: false,
        defaultValue: "draft",
    });

    await addColumnIfMissing(queryInterface, "Posts", "slug", { type: DataTypes.STRING(160), allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "excerpt", { type: DataTypes.STRING(320), allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "readingTime", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 });
    await addColumnIfMissing(queryInterface, "Posts", "publishedAt", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "scheduledAt", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "reviewedBy", { type: DataTypes.INTEGER, allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "reviewedAt", { type: DataTypes.DATE, allowNull: true });
    await addColumnIfMissing(queryInterface, "Posts", "rejectionReason", { type: DataTypes.STRING(500), allowNull: true });

    // Existing posts: give each a unique slug, a stored excerpt and reading time, and treat already
    // published ones as published when they were created. Only posts without a slug are touched,
    // so a re-run after an interruption continues where it stopped and never overwrites real data.
    const taken = await queryInterface.sequelize.query("SELECT slug FROM `Posts` WHERE slug IS NOT NULL", { type: QueryTypes.SELECT });
    const used = new Set(taken.map((row) => row.slug));
    const pending = await queryInterface.sequelize.query(
        "SELECT id, title, content, status, createdAt FROM `Posts` WHERE slug IS NULL ORDER BY id",
        { type: QueryTypes.SELECT },
    );
    for (const post of pending) {
        const base = slugify(post.title);
        let slug = used.has(base) ? `${base}-${post.id}` : base;
        for (let n = 2; used.has(slug); n += 1) slug = `${base}-${post.id}-${n}`;
        used.add(slug);
        await queryInterface.sequelize.query(
            "UPDATE `Posts` SET slug = :slug, excerpt = :excerpt, readingTime = :readingTime, publishedAt = :publishedAt WHERE id = :id",
            {
                replacements: {
                    id: post.id,
                    slug,
                    excerpt: autoExcerpt(post.content),
                    readingTime: readingTimeOf(post.content),
                    publishedAt: post.status === "published" ? post.createdAt : null,
                },
            },
        );
    }

    await addIndexIfMissing(queryInterface, "Posts", ["slug"], { name: "uq_posts_slug", unique: true });
    // public listing, newest published first
    await addIndexIfMissing(queryInterface, "Posts", ["status", "publishedAt"], { name: "idx_posts_status_published" });
    // an author's own posts by status
    await addIndexIfMissing(queryInterface, "Posts", ["userId", "status", "updatedAt"], { name: "idx_posts_user_status_updated" });
    // the scheduler's "what is due" query
    await addIndexIfMissing(queryInterface, "Posts", ["status", "scheduledAt"], { name: "idx_posts_status_scheduled" });
    // the composite index above now serves the Posts.userId foreign key; drop the stand-in a previous revert left behind
    if (await hasIndex(queryInterface, "Posts", "idx_posts_user")) {
        await queryInterface.removeIndex("Posts", "idx_posts_user");
    }
    await addConstraintIfMissing(queryInterface, "Posts", {
        type: "foreign key",
        name: "fk_posts_reviewer",
        fields: ["reviewedBy"],
        references: { table: "Users", field: "id" },
        onDelete: "SET NULL",
        onUpdate: "CASCADE",
    });
};

export const down = async ({ context: queryInterface }) => {
    // the Posts.userId foreign key now relies on the (userId, status, updatedAt) index; give it an
    // index of its own before that one is dropped
    if (!(await hasIndex(queryInterface, "Posts", "idx_posts_user"))) {
        await queryInterface.addIndex("Posts", ["userId"], { name: "idx_posts_user" });
    }
    await queryInterface.removeConstraint("Posts", "fk_posts_reviewer");
    for (const index of ["idx_posts_status_scheduled", "idx_posts_user_status_updated", "idx_posts_status_published", "uq_posts_slug"]) {
        await queryInterface.removeIndex("Posts", index);
    }
    for (const column of ["rejectionReason", "reviewedAt", "reviewedBy", "scheduledAt", "publishedAt", "readingTime", "excerpt", "slug"]) {
        await queryInterface.removeColumn("Posts", column);
    }
    // the old schema only knows draft and published; anything else becomes a draft rather than failing
    await queryInterface.sequelize.query("UPDATE `Posts` SET status = 'draft' WHERE status NOT IN ('draft', 'published')");
    await queryInterface.changeColumn("Posts", "status", {
        type: DataTypes.ENUM("draft", "published"),
        allowNull: false,
        defaultValue: "draft",
    });
};
