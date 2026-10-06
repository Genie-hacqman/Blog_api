import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import sequelize from "../database/dbconnection.js";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { makeImage } from "./imageHelpers.js";
import { Media } from "../database/models/index.js";
import { clearStoredFiles, storedFiles } from "../providers/storage/memory.js";
import { sweepOrphanMedia } from "../jobs/sweepOrphanMedia.js";
import { ORPHAN_GRACE_HOURS } from "../config/media.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const HOUR_MS = 60 * 60 * 1000;

describe("orphan media sweep", () => {
    let author;

    before(resetDatabase);
    after(closeDatabase);
    beforeEach(async () => {
        clearStoredFiles();
        await sequelize.query("DELETE FROM `post_media`");
        await sequelize.query("UPDATE `Posts` SET coverMediaId = NULL");
        await Media.destroy({ where: {} });
        author ??= await registerAndLogin({ role: "author" });
    });

    const upload = async (purpose) =>
        (await request(app).post("/api/media").set(bearer(author.token)).field("purpose", purpose).attach("file", await makeImage(), { filename: "p.jpg", contentType: "image/jpeg" })).body.data.media;
    const age = (id, hours) => sequelize.query("UPDATE `media` SET createdAt = :at WHERE id = :id", { replacements: { id, at: new Date(Date.now() - hours * HOUR_MS) } });
    const live = async (id) => (await Media.findByPk(id)).deletedAt === null;

    it("removes old images that no post uses, row and file, and leaves everything else alone", async () => {
        const unusedOld = await upload("inline");
        const unusedCover = await upload("cover");
        const unusedNew = await upload("inline");
        const inlineInUse = await upload("inline");
        const coverInUse = await upload("cover");
        await request(app).post("/api/posts").set(bearer(author.token)).send({ title: "Uses images", content: `<p>x</p><img src="${inlineInUse.url}">`, coverMediaId: coverInUse.id });
        for (const media of [unusedOld, unusedCover, inlineInUse, coverInUse]) await age(media.id, ORPHAN_GRACE_HOURS + 1);
        await age(unusedNew.id, ORPHAN_GRACE_HOURS - 1);
        const avatar = await Media.create({ ownerId: author.user.id, key: `u/${author.user.id}/old-avatar.webp`, mime: "image/webp", size: 1, width: 1, height: 1, purpose: "avatar" });
        await age(avatar.id, 1000);
        const filesBefore = storedFiles.size;

        const removed = await sweepOrphanMedia();

        assert.equal(removed, 2);
        assert.equal(await live(unusedOld.id), false);
        assert.equal(await live(unusedCover.id), false);
        for (const kept of [unusedNew, inlineInUse, coverInUse]) assert.equal(await live(kept.id), true, `media ${kept.id} should stay`);
        assert.equal(await live(avatar.id), true, "profile photos are never swept");
        assert.equal(storedFiles.size, filesBefore - 2, "the files are gone from storage too");
    });

    it("an image whose post was deleted becomes removable, and a second run finds nothing more", async () => {
        const image = await upload("inline");
        const post = (await request(app).post("/api/posts").set(bearer(author.token)).send({ title: "Short lived", content: `<p>x</p><img src="${image.url}">` })).body.data.post;
        await age(image.id, ORPHAN_GRACE_HOURS + 1);
        assert.equal(await sweepOrphanMedia(), 0, "in use");

        await request(app).delete(`/api/posts/${post.id}`).set(bearer(author.token));

        assert.equal(await sweepOrphanMedia(), 1);
        assert.equal(await sweepOrphanMedia(), 0);
    });

    it("works through several unused images in one run", async () => {
        for (let i = 0; i < 5; i += 1) await upload("inline");
        await sequelize.query("UPDATE `media` SET createdAt = :at", { replacements: { at: new Date(Date.now() - (ORPHAN_GRACE_HOURS + 1) * HOUR_MS) } });

        assert.equal(await sweepOrphanMedia(), 5);
        assert.equal(await Media.count({ where: { deletedAt: null } }), 0);
    });
});
