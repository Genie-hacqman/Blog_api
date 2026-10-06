import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { makeImage, pixelBomb, svgFile, textFile } from "./imageHelpers.js";
import { Media } from "../database/models/index.js";
import { clearStoredFiles, storedFiles } from "../providers/storage/memory.js";
import { getStorage } from "../providers/storage/index.js";
import { MAX_UPLOADS_PER_DAY } from "../config/media.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const upload = (token, buffer, { purpose = "cover", filename = "photo.jpg", contentType = "image/jpeg" } = {}) =>
    request(app).post("/api/media").set(bearer(token)).field("purpose", purpose).attach("file", buffer, { filename, contentType });

describe("media uploads", () => {
    let author;

    before(resetDatabase);
    after(closeDatabase);
    beforeEach(async () => {
        clearStoredFiles();
        await Media.destroy({ where: {} });
        author ??= await registerAndLogin({ role: "author" });
    });

    it("stores a re-encoded WebP under a server-chosen key and returns its URL", async () => {
        const response = await upload(author.token, await makeImage({ width: 400, height: 300 }), { purpose: "inline" });

        assert.equal(response.status, 201);
        const { media } = response.body.data;
        assert.equal(media.purpose, "inline");
        assert.equal(media.width, 400);
        assert.match(media.url, new RegExp(`^/media/u/${author.user.id}/[0-9a-f-]{36}\\.webp$`));

        const [[key, stored]] = [...storedFiles.entries()];
        assert.equal(`/media/${key}`, media.url);
        assert.equal(stored.contentType, "image/webp");
        assert.equal((await sharp(stored.body).metadata()).format, "webp");
    });

    it("never stores the client's filename, in the key or anywhere else", async () => {
        const response = await upload(author.token, await makeImage(), { filename: "../../etc/passwd.png" });

        assert.equal(response.status, 201);
        assert.ok(!JSON.stringify(response.body).includes("passwd"));
        assert.ok([...storedFiles.keys()].every((key) => !key.includes("passwd") && !key.includes("..")));
    });

    it("strips EXIF and GPS data from what is stored", async () => {
        const original = await makeImage({ exif: true });
        assert.ok((await sharp(original).metadata()).exif, "the test image should carry EXIF");

        await upload(author.token, original);

        const [{ body }] = [...storedFiles.values()];
        const stored = await sharp(body).metadata();
        assert.equal(stored.exif, undefined);
        assert.ok(!body.includes(Buffer.from("SecretCam")));
    });

    it("downsizes to the purpose's limits and never enlarges", async () => {
        const big = await upload(author.token, await makeImage({ width: 3000, height: 2000 }), { purpose: "cover" });
        assert.ok(big.body.data.media.width <= 1600 && big.body.data.media.height <= 900);

        const small = await upload(author.token, await makeImage({ width: 200, height: 100 }), { purpose: "cover" });
        assert.equal(small.body.data.media.width, 200);
    });

    it("accepts PNG, WebP and GIF input too", async () => {
        for (const format of ["png", "webp", "gif"]) {
            const response = await upload(author.token, await makeImage({ format }), { filename: `x.${format}` });
            assert.equal(response.status, 201, `${format} should be accepted`);
        }
    });

    it("trusts the file's bytes, not its name or declared type", async () => {
        const text = await upload(author.token, textFile(), { filename: "photo.png", contentType: "image/png" });
        const svg = await upload(author.token, svgFile(), { filename: "logo.svg", contentType: "image/svg+xml" });
        const disguisedSvg = await upload(author.token, svgFile(), { filename: "photo.png", contentType: "image/png" });

        for (const response of [text, svg, disguisedSvg]) {
            assert.equal(response.status, 415);
            assert.equal(response.body.error.code, "UNSUPPORTED_MEDIA_TYPE");
        }
        assert.equal(storedFiles.size, 0);
        assert.equal(await Media.count(), 0);
    });

    it("rejects a truncated image that has a valid header", async () => {
        const good = await makeImage({ width: 600, height: 600, format: "png" });

        const response = await upload(author.token, good.subarray(0, 200), { filename: "cut.png", contentType: "image/png" });

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "INVALID_IMAGE");
    });

    it("rejects an image with too many pixels", async () => {
        const response = await upload(author.token, await pixelBomb(), { filename: "bomb.png", contentType: "image/png" });

        assert.equal(response.status, 400);
        assert.equal(response.body.error.code, "INVALID_IMAGE");
    });

    it("rejects files over 5 MB with 413", async () => {
        const huge = Buffer.concat([await makeImage(), Buffer.alloc(5 * 1024 * 1024 + 10)]);

        const response = await upload(author.token, huge);

        assert.equal(response.status, 413);
        assert.equal(response.body.error.code, "PAYLOAD_TOO_LARGE");
    });

    it("rejects a missing file, a wrong field name, and a bad purpose", async () => {
        const none = await request(app).post("/api/media").set(bearer(author.token)).field("purpose", "cover");
        const wrongField = await request(app).post("/api/media").set(bearer(author.token)).field("purpose", "cover").attach("photo", await makeImage(), "a.jpg");
        const avatarPurpose = await upload(author.token, await makeImage(), { purpose: "avatar" });
        const noPurpose = await request(app).post("/api/media").set(bearer(author.token)).attach("file", await makeImage(), "a.jpg");

        assert.equal(none.status, 400);
        assert.equal(wrongField.status, 400);
        assert.equal(avatarPurpose.status, 400, "profile photos use PUT /api/users/me/avatar");
        assert.equal(noPurpose.status, 400);
    });

    it("needs a signed-in, verified author", async () => {
        const reader = await registerAndLogin({ role: "user" });
        const unverified = await registerAndLogin({ role: "author", verified: false });
        const image = await makeImage();

        assert.equal((await request(app).post("/api/media").field("purpose", "cover").attach("file", image, "a.jpg")).status, 401);
        assert.equal((await upload(reader.token, image)).status, 403, "readers cannot upload post images");
        const notVerified = await upload(unverified.token, image);
        assert.equal(notVerified.status, 403);
        assert.equal(notVerified.body.error.code, "EMAIL_NOT_VERIFIED");
    });

    it("enforces a per-user daily upload quota", async () => {
        const rows = Array.from({ length: MAX_UPLOADS_PER_DAY }, (_, i) => ({
            ownerId: author.user.id, key: `u/${author.user.id}/seed-${i}.webp`, mime: "image/webp", size: 1, width: 1, height: 1, purpose: "inline",
        }));
        await Media.bulkCreate(rows);

        const response = await upload(author.token, await makeImage());

        assert.equal(response.status, 429);
        assert.equal(storedFiles.size, 0);
    });

    it("removes the row when the file cannot be stored", async () => {
        const storage = getStorage();
        const original = storage.put;
        storage.put = async () => {
            throw new Error("bucket unreachable");
        };
        try {
            const response = await upload(author.token, await makeImage());
            assert.equal(response.status, 500);
            assert.ok(!JSON.stringify(response.body).includes("bucket"));
        } finally {
            storage.put = original;
        }
        assert.equal(await Media.count(), 0);
    });

    it("lets the owner delete their image (row and file); others get 404", async () => {
        const mine = await upload(author.token, await makeImage());
        const { id, url } = mine.body.data.media;
        const stranger = await registerAndLogin({ role: "author" });

        assert.equal((await request(app).delete(`/api/media/${id}`).set(bearer(stranger.token))).status, 404);
        assert.equal(storedFiles.size, 1);

        assert.equal((await request(app).delete(`/api/media/${id}`).set(bearer(author.token))).status, 200);
        assert.equal(storedFiles.size, 0);
        assert.ok((await Media.findByPk(id)).deletedAt, "the row is kept, marked deleted");
        assert.ok(url);

        assert.equal((await request(app).delete(`/api/media/${id}`).set(bearer(author.token))).status, 404);
        assert.equal((await request(app).delete("/api/media/abc").set(bearer(author.token))).status, 404);
    });

    it("keeps a failed file removal from failing the delete", async () => {
        const mine = await upload(author.token, await makeImage());
        const storage = getStorage();
        const original = storage.delete;
        storage.delete = async () => {
            throw new Error("bucket unreachable");
        };
        try {
            assert.equal((await request(app).delete(`/api/media/${mine.body.data.media.id}`).set(bearer(author.token))).status, 200);
        } finally {
            storage.delete = original;
        }
    });
});
