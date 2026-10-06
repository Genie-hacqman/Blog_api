import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase } from "./helpers.js";
import { makeImage, svgFile } from "./imageHelpers.js";
import { Media, User } from "../database/models/index.js";
import { clearStoredFiles, storedFiles } from "../providers/storage/memory.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const patchMe = (token, body) => request(app).patch("/api/users/me").set(bearer(token)).send(body);
const putAvatar = (token, buffer, filename = "me.jpg") => request(app).put("/api/users/me/avatar").set(bearer(token)).attach("file", buffer, filename);
const createPost = (token, body) => request(app).post("/api/posts").set(bearer(token)).send({ title: "A post", content: "Some content", status: "published", ...body });

// one pool for the whole file: close it once, after the last describe
after(closeDatabase);

describe("public profiles", () => {
    let ada;

    before(resetDatabase);
    before(async () => {
        ada = await registerAndLogin({ role: "editor", userName: "ada_l", firstName: "Ada", lastName: "Lovelace" });
        await patchMe(ada.token, { bio: "I write about engines.", socialLinks: { github: "https://github.com/ada" } });
        await createPost(ada.token, { title: "Published one" });
        await createPost(ada.token, { title: "Secret draft", status: "draft" });
    });

    it("shows username, bio, links, join date and post count, and nothing private", async () => {
        const response = await request(app).get("/api/users/ada_l");

        assert.equal(response.status, 200);
        const { user } = response.body.data;
        assert.equal(user.username, "ada_l");
        assert.equal(user.bio, "I write about engines.");
        assert.deepEqual(user.socialLinks, { github: "https://github.com/ada" });
        assert.equal(user.postCount, 1, "drafts are not counted");
        assert.ok(user.joinedAt);
        assert.deepEqual(Object.keys(user).sort(), ["avatarUrl", "bio", "followerCount", "followingCount", "joinedAt", "postCount", "socialLinks", "username"]);
        assert.deepEqual([user.followerCount, user.followingCount], [0, 0]);
        const raw = JSON.stringify(response.body);
        for (const secret of [ada.credentials.email, "Lovelace", "\"Ada\"", "role", "password", "emailVerified"]) {
            assert.ok(!raw.includes(secret), `${secret} must not appear in a public profile`);
        }
    });

    it("needs no login, is case-insensitive, and 404s for unknown names", async () => {
        assert.equal((await request(app).get("/api/users/ADA_L")).status, 200);
        assert.equal((await request(app).get("/api/users/nobody_here")).status, 404);
    });

    it("lists only that author's published posts, as previews", async () => {
        const other = await registerAndLogin({ role: "editor" });
        await createPost(other.token, { title: "Someone else's post" });

        const response = await request(app).get("/api/users/ada_l/posts");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data.posts.map((post) => post.title), ["Published one"]);
        assert.ok(!("content" in response.body.data.posts[0]));
        assert.equal(response.body.meta.pagination.total, 1);
        assert.equal(response.body.data.posts[0].author.username, "ada_l");
    });

    it("paginates the author's posts", async () => {
        const writer = await registerAndLogin({ role: "editor", userName: "prolific" });
        for (let i = 1; i <= 3; i += 1) await createPost(writer.token, { title: `Post ${i}` });

        const page = await request(app).get("/api/users/prolific/posts?limit=2&page=2");

        assert.equal(page.body.data.posts.length, 1);
        assert.equal(page.body.meta.pagination.totalPages, 2);
    });

    it("hides suspended and deleted accounts like they do not exist", async () => {
        const gone = await registerAndLogin({ userName: "suspended_one" });
        await User.update({ status: "suspended" }, { where: { id: gone.user.id } });

        assert.equal((await request(app).get("/api/users/suspended_one")).status, 404);
        assert.equal((await request(app).get("/api/users/suspended_one/posts")).status, 404);
    });

    it("does not let /api/users/me be read as a username", async () => {
        assert.equal((await request(app).get("/api/users/me")).status, 404);
    });
});

describe("editing the profile", () => {
    let user;

    before(resetDatabase);
    before(async () => {
        user = await registerAndLogin();
    });

    it("updates bio and social links, and returns the private view", async () => {
        const response = await patchMe(user.token, {
            bio: "  Hello <b>there</b>  ",
            socialLinks: { website: "https://example.com/me", twitter: "https://x.com/me", linkedin: "https://www.linkedin.com/in/me" },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.user.bio, "Hello <b>there</b>", "trimmed, stored as plain text");
        assert.equal(response.body.data.user.email, user.credentials.email);
        assert.equal(response.body.data.user.socialLinks.twitter, "https://x.com/me");
    });

    it("clears the bio and individual links with empty values", async () => {
        const response = await patchMe(user.token, { bio: "   ", socialLinks: { website: "", github: "https://github.com/me" } });

        assert.equal(response.body.data.user.bio, null);
        assert.deepEqual(response.body.data.user.socialLinks, { github: "https://github.com/me" });

        const cleared = await patchMe(user.token, { socialLinks: null });
        assert.equal(cleared.body.data.user.socialLinks, null);
    });

    it("rejects dangerous or off-platform links", async () => {
        const bad = [
            { website: "javascript:alert(1)" },
            { website: "data:text/html,<script>alert(1)</script>" },
            { website: "http://example.com" },
            { website: "https://user:pass@example.com" },
            { website: "https://localhost/admin" },
            { website: "https://127.0.0.1/" },
            { website: "not a url" },
            { github: "https://evil.example/github.com" },
            { github: "https://github.com.evil.example/x" },
            { twitter: "https://github.com/me" },
            { facebook: "https://facebook.com/me" },
            { website: `https://example.com/${"a".repeat(200)}` },
        ];
        for (const socialLinks of bad) {
            const response = await patchMe(user.token, { socialLinks });
            assert.equal(response.status, 400, `${JSON.stringify(socialLinks).slice(0, 60)} must be rejected`);
        }
    });

    it("rejects a bio over 500 characters", async () => {
        assert.equal((await patchMe(user.token, { bio: "x".repeat(501) })).status, 400);
        assert.equal((await patchMe(user.token, { bio: "x".repeat(500) })).status, 200);
    });

    it("refuses any field it does not own (mass assignment) and empty updates", async () => {
        for (const body of [{ role: "admin" }, { bio: "ok", status: "active" }, { email: "x@example.com" }, { avatarMediaId: 1 }, { emailVerifiedAt: "2020-01-01" }, {}]) {
            const response = await patchMe(user.token, body);
            assert.equal(response.status, 400, `${JSON.stringify(body)} must be rejected`);
        }
        const stored = await User.findByPk(user.user.id);
        assert.equal(stored.role, "author");
    });

    it("requires authentication", async () => {
        assert.equal((await request(app).patch("/api/users/me").send({ bio: "x" })).status, 401);
    });
});

describe("avatars", () => {
    let user;

    before(resetDatabase);
    before(async () => {
        clearStoredFiles();
        user = await registerAndLogin({ role: "user" });
    });

    it("lets any verified user upload a square WebP avatar, which appears on their profile", async () => {
        const response = await putAvatar(user.token, await makeImage({ width: 900, height: 600 }));

        assert.equal(response.status, 200);
        const { avatarUrl } = response.body.data.user;
        assert.match(avatarUrl, /^\/media\/u\/\d+\/[0-9a-f-]{36}\.webp$/);

        const profile = await request(app).get(`/api/users/${user.credentials.userName}`);
        assert.equal(profile.body.data.user.avatarUrl, avatarUrl);
        const me = await request(app).get("/api/auth/me").set(bearer(user.token));
        assert.equal(me.body.data.user.avatarUrl, avatarUrl);

        const media = await Media.findOne({ where: { ownerId: user.user.id, purpose: "avatar" } });
        assert.equal(media.width, 512);
        assert.equal(media.height, 512);
    });

    it("replacing the avatar retires the old file and row", async () => {
        const before = [...storedFiles.keys()];
        assert.equal(before.length, 1);

        const response = await putAvatar(user.token, await makeImage());

        assert.equal(response.status, 200);
        const after = [...storedFiles.keys()];
        assert.equal(after.length, 1);
        assert.notEqual(after[0], before[0]);
        assert.ok((await Media.findOne({ where: { key: before[0] } })).deletedAt);
    });

    it("removing the avatar clears it and deletes the file", async () => {
        const response = await request(app).delete("/api/users/me/avatar").set(bearer(user.token));

        assert.equal(response.status, 200);
        assert.equal(response.body.data.user.avatarUrl, null);
        assert.equal(storedFiles.size, 0);
        assert.equal((await request(app).delete("/api/users/me/avatar").set(bearer(user.token))).status, 200, "removing twice is harmless");
    });

    it("rejects non-images and SVG, and keeps the existing avatar", async () => {
        await putAvatar(user.token, await makeImage());
        const keys = [...storedFiles.keys()];

        assert.equal((await putAvatar(user.token, svgFile(), "me.svg")).status, 415);
        assert.equal((await putAvatar(user.token, Buffer.from("plain text"), "me.png")).status, 415);

        assert.deepEqual([...storedFiles.keys()], keys);
    });

    it("needs a verified email and a login", async () => {
        const unverified = await registerAndLogin({ role: "user", verified: false });

        const denied = await putAvatar(unverified.token, await makeImage());
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error.code, "EMAIL_NOT_VERIFIED");
        assert.equal((await request(app).put("/api/users/me/avatar").attach("file", await makeImage(), "a.jpg")).status, 401);
    });

    it("shows the avatar on posts, and a missing one as null", async () => {
        const withAvatar = await registerAndLogin({ role: "editor" });
        await putAvatar(withAvatar.token, await makeImage());
        await request(app).post("/api/posts").set(bearer(withAvatar.token)).send({ title: "Pretty", content: "Face", status: "published" });
        const plain = await registerAndLogin({ role: "editor" });
        await request(app).post("/api/posts").set(bearer(plain.token)).send({ title: "Plain", content: "No face", status: "published" });

        const list = await request(app).get("/api/posts");

        const byTitle = Object.fromEntries(list.body.data.posts.map((post) => [post.title, post.author]));
        assert.match(byTitle.Pretty.avatarUrl, /^\/media\//);
        assert.equal(byTitle.Plain.avatarUrl, null);
    });
});

describe("usernames", () => {
    before(resetDatabase);

    const register = (userName) =>
        request(app).post("/api/auth/register").send({ firstName: "N", lastName: "N", userName, email: `${Math.random().toString(36).slice(2)}@example.com`, password: "password123" });

    it("accepts 3 to 30 letters, digits and underscores", async () => {
        for (const name of ["abc", "Ada_99", "a".repeat(30), "___"]) {
            assert.equal((await register(name)).status, 201, `${name} should be allowed`);
        }
    });

    it("rejects short, long, spaced, symbol and non-ASCII names", async () => {
        for (const name of ["ab", "a".repeat(31), "has space", "dot.name", "dash-name", "emoji😀", "slash/name", "../x", "<script>"]) {
            assert.equal((await register(name)).status, 400, `${name} should be rejected`);
        }
    });

    it("rejects reserved names in any case", async () => {
        for (const name of ["admin", "Admin", "API", "settings", "support", "null"]) {
            const response = await register(name);
            assert.equal(response.status, 400, `${name} should be reserved`);
            assert.equal(response.body.error.message, "that username is not available");
        }
    });
});
