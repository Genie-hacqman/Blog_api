import { addIndexIfMissing, hasColumn, hasIndex } from "../migrationHelpers.js";
// Only the way back needs a real HTML reader. It is imported here and not copied: reversing arbitrary
// HTML is the one job a parser is for, whereas the way forward below is small enough to be frozen in place.
import { htmlToPlainText } from "../../utils/richText.js";

const BATCH = 100;

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plain text becomes paragraphs: a blank line starts a new one, a single line break stays a <br>.
// (A copy of the rule the application uses; migrations must not change meaning when the application does.)
const toHtml = (text) =>
    String(text ?? "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("");

// the readable text of the plain-text original: the same words, whitespace collapsed
const toText = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

// Existing posts (and their saved revisions) were written as plain text. Convert them to the HTML the
// editor produces, so there is exactly one format. Each post is converted in ONE transaction together
// with its revisions, and only posts without contentText are picked up, so an interrupted run continues
// where it stopped. Then search moves from the raw content to the plain text.
export const up = async ({ context: queryInterface }) => {
    const { sequelize } = queryInterface;

    for (;;) {
        const [posts] = await sequelize.query("SELECT id, content FROM `Posts` WHERE contentText IS NULL ORDER BY id LIMIT :limit", { replacements: { limit: BATCH } });
        if (posts.length === 0) break;

        for (const post of posts) {
            await sequelize.transaction(async (transaction) => {
                await sequelize.query("UPDATE `Posts` SET content = :html, contentText = :text WHERE id = :id AND contentText IS NULL", {
                    replacements: { id: post.id, html: toHtml(post.content), text: toText(post.content) },
                    transaction,
                });
                const [revisions] = await sequelize.query("SELECT id, content FROM `post_revisions` WHERE postId = :id", { replacements: { id: post.id }, transaction });
                for (const revision of revisions) {
                    await sequelize.query("UPDATE `post_revisions` SET content = :html WHERE id = :id", {
                        replacements: { id: revision.id, html: toHtml(revision.content) },
                        transaction,
                    });
                }
            });
        }
    }

    // search reads the plain text, so markup, class names and URLs are never matched
    if (await hasIndex(queryInterface, "Posts", "ft_posts_body")) await queryInterface.removeIndex("Posts", "ft_posts_body");
    await addIndexIfMissing(queryInterface, "Posts", ["excerpt", "contentText"], { name: "ft_posts_text", type: "FULLTEXT" });
};

export const down = async ({ context: queryInterface }) => {
    const { sequelize } = queryInterface;

    if (await hasIndex(queryInterface, "Posts", "ft_posts_text")) await queryInterface.removeIndex("Posts", "ft_posts_text");

    if (await hasColumn(queryInterface, "Posts", "contentText")) {
        for (;;) {
            const [posts] = await sequelize.query("SELECT id, content FROM `Posts` WHERE contentText IS NOT NULL ORDER BY id LIMIT :limit", { replacements: { limit: BATCH } });
            if (posts.length === 0) break;
            for (const post of posts) {
                await sequelize.transaction(async (transaction) => {
                    // contentText goes back to NULL, which is what marks a post as "not converted yet" for a later up
                    await sequelize.query("UPDATE `Posts` SET content = :text, contentText = NULL WHERE id = :id", {
                        replacements: { id: post.id, text: htmlToPlainText(post.content) },
                        transaction,
                    });
                    const [revisions] = await sequelize.query("SELECT id, content FROM `post_revisions` WHERE postId = :id", { replacements: { id: post.id }, transaction });
                    for (const revision of revisions) {
                        await sequelize.query("UPDATE `post_revisions` SET content = :text WHERE id = :id", {
                            replacements: { id: revision.id, text: htmlToPlainText(revision.content) },
                            transaction,
                        });
                    }
                });
            }
        }
    }
    if (!(await hasIndex(queryInterface, "Posts", "ft_posts_body"))) {
        await queryInterface.addIndex("Posts", ["excerpt", "content"], { name: "ft_posts_body", type: "FULLTEXT" });
    }
};
