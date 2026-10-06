import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs } from "./helpers.js";
import { Notification, Post, User } from "../database/models/index.js";
import { clearSentEmails, sentEmails } from "../providers/email/memory.js";
import { getEmailProvider } from "../providers/email/index.js";
import { handleEmail } from "../services/notificationService.js";
import { signUnsubscribeToken } from "../utils/unsubscribeToken.js";
import { env } from "../config/env.js";
import { MAX_EMAILS_PER_HOUR, UNSUBSCRIBE_AUDIENCE } from "../config/notifications.js";
import { JWT_ISSUER } from "../config/auth.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const publish = (owner, title) => request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content: "<p>Some words to read.</p>", status: "published" });
const comment = (who, postId, body) => request(app).post(`/api/posts/${postId}/comments`).set(bearer(who.token)).send({ body });
const follow = (who, username) => request(app).put(`/api/users/${username}/follow`).set(bearer(who.token));
const putPrefs = (who, preferences) => request(app).put("/api/notifications/preferences").set(bearer(who.token)).send({ preferences });
const getPrefs = async (who) => Object.fromEntries((await request(app).get("/api/notifications/preferences").set(bearer(who.token))).body.data.preferences.map((p) => [p.type, p]));
const emailsTo = (who) => sentEmails.filter((message) => message.to === who.credentials.email);
const unsubscribeToken = (message) => decodeURIComponent(/unsubscribe\?token=([^\s"&]+)/.exec(message.text)[1]);

after(closeDatabase);

describe("notification emails", () => {
    let owner;
    let reader;
    let story;

    before(resetDatabase);
    before(async () => {
        owner = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        story = (await publish(owner, "Email story")).body.data.post;
        await settleJobs();
        clearSentEmails();
    });

    it("emails a story's author about a comment, with the words, a link, and a way to stop", async () => {
        await comment(reader, story.id, "Lovely <b>writing</b> & more");
        await settleJobs();

        const [message, ...rest] = emailsTo(owner);
        assert.equal(rest.length, 0);
        assert.equal(message.subject, `${reader.credentials.userName} commented on “Email story”`);
        assert.ok(message.text.includes("Lovely <b>writing</b> & more"));
        assert.ok(message.html.includes("Lovely &lt;b&gt;writing&lt;/b&gt; &amp; more"));
        assert.ok(message.text.includes(`${env.APP_URL}/blog/${story.slug}#comments`));
        assert.match(message.headers["List-Unsubscribe"], /^<.+\/api\/notifications\/unsubscribe\?token=.+>$/);
        assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
        const row = await Notification.findOne({ where: { recipientId: owner.user.id } });
        assert.ok(row.emailedAt, "the notification remembers it was emailed");
    });

    it("does not email about a new follower unless that is switched on", async () => {
        clearSentEmails();
        const fan = await registerAndLogin({ role: "user" });
        await follow(fan, owner.credentials.userName);
        await settleJobs();
        assert.equal(emailsTo(owner).length, 0, "off by default");
        assert.equal((await request(app).get("/api/notifications?unread=1").set(bearer(owner.token))).body.data.notifications.some((n) => n.type === "new_follower"), true, "but it is in the inbox");

        await putPrefs(owner, [{ type: "new_follower", inApp: true, email: true }]);
        const second = await registerAndLogin({ role: "user" });
        await follow(second, owner.credentials.userName);
        await settleJobs();
        assert.equal(emailsTo(owner).length, 1);
        assert.match(emailsTo(owner)[0].subject, /started following you/);
    });

    it("sends nothing to an unconfirmed email address, but the inbox still gets the notification", async () => {
        const unconfirmed = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(unconfirmed, "Unconfirmed story")).body.data.post;
        // writing needs a confirmed address, so confirmation is taken away afterwards
        await User.update({ emailVerifiedAt: null }, { where: { id: unconfirmed.user.id } });
        clearSentEmails();

        await comment(reader, theirs.id, "Hello?");
        await settleJobs();

        assert.equal(emailsTo(unconfirmed).length, 0);
        assert.equal(await Notification.count({ where: { recipientId: unconfirmed.user.id } }), 1);
    });

    it("sends nothing when email is switched off for that kind, and nothing to a suspended account", async () => {
        const quiet = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(quiet, "Quiet story")).body.data.post;
        clearSentEmails(); // registering sent a confirmation email
        await putPrefs(quiet, [{ type: "comment_on_post", inApp: true, email: false }]);
        await comment(reader, theirs.id, "No email please");
        await settleJobs();
        assert.equal(emailsTo(quiet).length, 0);

        await putPrefs(quiet, [{ type: "comment_on_post", inApp: true, email: true }]);
        await comment(reader, theirs.id, "Email this one");
        await settleJobs();
        assert.equal(emailsTo(quiet).length, 1);

        await User.update({ status: "suspended" }, { where: { id: quiet.user.id } });
        await comment(reader, theirs.id, "Too late");
        await settleJobs();
        assert.equal(emailsTo(quiet).length, 1);
    });

    it("never sends more than the hourly limit to one person, though the inbox keeps everything", async () => {
        const popular = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(popular, "Popular story")).body.data.post;
        clearSentEmails();
        const now = new Date();
        await Notification.bulkCreate(
            Array.from({ length: MAX_EMAILS_PER_HOUR }, (_, i) => ({ recipientId: popular.user.id, type: "new_follower", dedupeKey: `filler:${i}`, inApp: false, emailedAt: now })),
        );

        await comment(reader, theirs.id, "One more than allowed");
        await settleJobs();

        assert.equal(emailsTo(popular).length, 0);
        const inbox = (await request(app).get("/api/notifications").set(bearer(popular.token))).body.data.notifications;
        assert.equal(inbox.length, 1);
    });

    it("keeps the subject on one line even when a story's title holds line breaks", async () => {
        const crafty = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(crafty, "Plain title")).body.data.post;
        clearSentEmails();
        await Post.update({ title: "Hello\r\nBcc: evil@example.com\r\n\r\nbody" }, { where: { id: theirs.id } });

        await comment(reader, theirs.id, "Hi");
        await settleJobs();

        const [message] = emailsTo(crafty);
        assert.ok(!/[\r\n]/.test(message.subject), JSON.stringify(message.subject));
        assert.ok(!Object.keys(message).includes("bcc"));
    });

    it("sends once when the job is run twice at the same moment", async () => {
        const twice = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(twice, "Twice story")).body.data.post;
        const row = await Notification.create({ recipientId: twice.user.id, actorId: reader.user.id, type: "comment_on_post", postId: theirs.id, dedupeKey: "manual:twice" });
        // a comment for the row, so that it has something to show
        const written = (await comment(reader, theirs.id, "for the row")).body.data.comment;
        await settleJobs();
        clearSentEmails();
        await row.update({ commentId: written.id });

        const results = await Promise.all([handleEmail({ notificationId: row.id }), handleEmail({ notificationId: row.id })]);

        assert.deepEqual(results.sort(), ["sent", "skipped"]);
        assert.equal(emailsTo(twice).length, 1);
    });

    it("tries again when the mail server fails, and still sends exactly one email", async () => {
        const flaky = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(flaky, "Flaky story")).body.data.post;
        clearSentEmails();
        const provider = getEmailProvider();
        const original = provider.send;
        let failures = 0;
        provider.send = async (message) => {
            if (failures < 2) {
                failures += 1;
                throw new Error("SMTP is down");
            }
            return original.call(provider, message);
        };
        try {
            await comment(reader, theirs.id, "Please deliver");
            await settleJobs();
        } finally {
            provider.send = original;
        }

        assert.equal(failures, 2);
        assert.equal(emailsTo(flaky).length, 1);
        assert.ok((await Notification.findOne({ where: { recipientId: flaky.user.id } })).emailedAt);
    });

    it("sends nothing about a story that stopped being public before the email was sent", async () => {
        const late = await registerAndLogin({ role: "editor" });
        const theirs = (await publish(late, "Pulled story")).body.data.post;
        const written = (await comment(reader, theirs.id, "Hello")).body.data.comment;
        await settleJobs();
        const row = await Notification.findOne({ where: { recipientId: late.user.id, commentId: written.id } });
        await row.update({ emailedAt: null });
        clearSentEmails();
        await Post.update({ status: "archived" }, { where: { id: theirs.id } });

        assert.equal(await handleEmail({ notificationId: row.id }), "skipped");
        assert.equal(emailsTo(late).length, 0);
    });
});

describe("unsubscribing", () => {
    let owner;
    let reader;
    let story;

    before(resetDatabase);
    before(async () => {
        owner = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        story = (await publish(owner, "Unsubscribe story")).body.data.post;
        await settleJobs();
        clearSentEmails();
    });

    const unsubscribe = (token) => request(app).post("/api/notifications/unsubscribe").send({ token });
    const commentAndEmails = async (text) => {
        clearSentEmails();
        await comment(reader, story.id, text);
        await settleJobs();
        return emailsTo(owner).length;
    };

    it("the link in an email turns off exactly that kind of email, and nothing else", async () => {
        assert.equal(await commentAndEmails("first"), 1);
        const token = unsubscribeToken(emailsTo(owner)[0]);

        const response = await unsubscribe(token);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, { scope: "comment_on_post", label: "Comments on your stories" });
        const prefs = await getPrefs(owner);
        assert.deepEqual([prefs.comment_on_post.inApp, prefs.comment_on_post.email], [true, false]);
        assert.equal(prefs.comment_reply.email, true, "other kinds are untouched");
        assert.equal(await commentAndEmails("second"), 0);
        assert.equal((await request(app).get("/api/notifications").set(bearer(owner.token))).body.data.notifications.length, 2, "the inbox still gets them");
    });

    it("works from a mail client's one-click POST, where the token is in the address", async () => {
        const token = signUnsubscribeToken(owner.user.id, "post_published");

        const response = await request(app)
            .post(`/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`)
            .type("form")
            .send("List-Unsubscribe=One-Click");

        assert.equal(response.status, 200);
        assert.equal((await getPrefs(owner)).post_published.email, false);
    });

    it("cannot be triggered by merely fetching the link", async () => {
        const token = signUnsubscribeToken(owner.user.id, "comment_reply");

        assert.equal((await request(app).get(`/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`)).status, 404);
        assert.equal((await getPrefs(owner)).comment_reply.email, true);
    });

    it("can turn off every kind at once", async () => {
        const response = await unsubscribe(signUnsubscribeToken(owner.user.id, "all"));

        assert.equal(response.body.data.scope, "all");
        const prefs = await getPrefs(owner);
        assert.ok(Object.values(prefs).every((p) => p.email === false && p.inApp === true));
    });

    it("refuses anything that is not a valid, unexpired unsubscribe token", async () => {
        const good = signUnsubscribeToken(owner.user.id, "all");
        const expired = jwt.sign({ scope: "all" }, env.JWT_SECRET, { subject: String(owner.user.id), audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER, expiresIn: -10 });
        const missingUser = signUnsubscribeToken(999999, "all");

        for (const token of ["garbage", `${good}x`, expired, missingUser, owner.token]) {
            const response = await unsubscribe(token);
            assert.equal(response.status, 400, token.slice(0, 20));
            assert.equal(response.body.error.code, "VALIDATION_ERROR");
        }
        for (const body of [{}, { token: "" }, { token: 5 }, { token: "x".repeat(3000) }]) {
            assert.equal((await request(app).post("/api/notifications/unsubscribe").send(body)).status, 400);
        }
    });

    it("an unsubscribe token is not a login", async () => {
        const token = signUnsubscribeToken(owner.user.id, "all");

        assert.equal((await request(app).get("/api/notifications").set(bearer(token))).status, 401);
        assert.equal((await request(app).get("/api/auth/me").set(bearer(token))).status, 401);
    });
});
