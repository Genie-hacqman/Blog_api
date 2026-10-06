import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalProvider } from "../../providers/storage/localDisk.js";
import { createS3Provider } from "../../providers/storage/s3.js";
import { assertSafeKey } from "../../providers/storage/keys.js";

describe("storage keys", () => {
    it("accepts server-generated keys", () => {
        assert.doesNotThrow(() => assertSafeKey("u/12/3f2b1c9e-0c1d-4e4a-9a53-3a6b7f1c2d3e.webp"));
    });

    it("rejects traversal, absolute paths, odd extensions and junk", () => {
        for (const key of ["../x.webp", "u/../../x.webp", "/etc/passwd.webp", "u//x.webp", "u/x.png", "u/x.webp/../../y.webp", "u/X.webp", "u/a b.webp", "", null, "a".repeat(300) + ".webp"]) {
            assert.throws(() => assertSafeKey(key), /Unsafe storage key/, `${key} must be refused`);
        }
    });
});

describe("local storage provider", () => {
    let root;
    beforeEach(async () => {
        root = await mkdtemp(path.join(tmpdir(), "blog-storage-"));
    });
    afterEach(() => rm(root, { recursive: true, force: true }));

    it("writes and deletes files under its root, and deleting twice is fine", async () => {
        const storage = createLocalProvider(root);
        await storage.put({ key: "u/1/a.webp", body: Buffer.from("hello") });

        assert.equal((await readFile(path.join(root, "u/1/a.webp"))).toString(), "hello");

        await storage.delete("u/1/a.webp");
        await assert.rejects(() => stat(path.join(root, "u/1/a.webp")), { code: "ENOENT" });
        await assert.doesNotReject(() => storage.delete("u/1/a.webp"));
    });

    it("refuses to write or delete outside its root", async () => {
        const storage = createLocalProvider(root);

        await assert.rejects(() => storage.put({ key: "../escape.webp", body: Buffer.from("x") }), /Unsafe storage key/);
        await assert.rejects(() => storage.delete("../escape.webp"), /Unsafe storage key/);
    });

    it("builds public URLs from the configured base", () => {
        assert.equal(createLocalProvider(root).publicUrl("u/1/a.webp"), "/media/u/1/a.webp");
    });
});

describe("s3 storage provider", () => {
    it("sends the right commands to the bucket with long-lived caching", async () => {
        const sent = [];
        const storage = createS3Provider({ send: async (command) => void sent.push(command) });

        await storage.put({ key: "u/1/a.webp", body: Buffer.from("x"), contentType: "image/webp" });
        await storage.delete("u/1/a.webp");

        assert.equal(sent[0].constructor.name, "PutObjectCommand");
        assert.equal(sent[0].input.Key, "u/1/a.webp");
        assert.equal(sent[0].input.ContentType, "image/webp");
        assert.match(sent[0].input.CacheControl, /immutable/);
        assert.equal(sent[1].constructor.name, "DeleteObjectCommand");
        assert.equal(sent[1].input.Key, "u/1/a.webp");
    });

    it("refuses unsafe keys before talking to the bucket", async () => {
        const sent = [];
        const storage = createS3Provider({ send: async (command) => void sent.push(command) });

        await assert.rejects(() => storage.put({ key: "../x.webp", body: Buffer.from("x") }), /Unsafe storage key/);
        assert.equal(sent.length, 0);
    });
});
