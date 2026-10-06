import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { app, request, registerAndLogin, resetDatabase, closeDatabase, settleJobs } from "./helpers.js";
import { AuditLog, Comment, Notification, Report, User } from "../database/models/index.js";
import { clearSentEmails, sentEmails } from "../providers/email/memory.js";
import { MAX_REPORTS_PER_HOUR } from "../config/moderation.js";

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const publish = (owner, title) => request(app).post("/api/posts").set(bearer(owner.token)).send({ title, content: "<p>Some words to read.</p>", status: "published" });
const comment = (who, postId, body) => request(app).post(`/api/posts/${postId}/comments`).set(bearer(who.token)).send({ body });
const report = (who, body) => request(app).post("/api/reports").set(who ? bearer(who.token) : {}).send(body);
const queue = (who, query = "") => request(app).get(`/api/moderation/reports${query}`).set(who ? bearer(who.token) : {});
const detail = (who, id) => request(app).get(`/api/moderation/reports/${id}`).set(bearer(who.token));
const resolve = (who, id, body) => request(app).post(`/api/moderation/reports/${id}/resolve`).set(who ? bearer(who.token) : {}).send(body);
const name = (account) => account.credentials.userName;
// a story and a comment can have the same id, so items are matched by kind as well
const aboutComment = (id) => (item) => item.targetType === "comment" && item.target?.id === id;

after(closeDatabase);

describe("filing reports", () => {
    let editor;
    let reader;
    let other;
    let story;
    let written;

    before(resetDatabase);
    before(async () => {
        editor = await registerAndLogin({ role: "editor" });
        reader = await registerAndLogin({ role: "user" });
        other = await registerAndLogin({ role: "user" });
        story = (await publish(editor, "Reported story")).body.data.post;
        written = (await comment(other, story.id, "A comment worth reporting")).body.data.comment;
    });

    it("lets a reader report a comment, a story and a person, and tells them nothing more than that it was filed", async () => {
        const forComment = await report(reader, { targetType: "comment", targetId: written.id, reason: "spam", details: "  Looks like an advert  " });
        const forStory = await report(reader, { targetType: "post", targetId: story.id, reason: "misinformation" });
        const forPerson = await report(reader, { targetType: "user", targetId: name(other), reason: "harassment" });

        for (const response of [forComment, forStory, forPerson]) assert.equal(response.status, 201);
        assert.deepEqual(Object.keys(forComment.body.data.report).sort(), ["createdAt", "id", "reason", "status", "targetType"]);
        assert.equal(forComment.body.data.report.status, "open");
        const row = await Report.findByPk(forComment.body.data.report.id);
        assert.equal(row.details, "Looks like an advert");
        assert.equal(row.targetKey, `comment:${written.id}`);
        assert.equal(row.commentId, written.id);
        assert.equal(row.postId, null);
    });

    it("answers 409 to a second report of the same thing by the same person, whatever the reason", async () => {
        const again = await report(reader, { targetType: "comment", targetId: written.id, reason: "hate" });

        assert.equal(again.status, 409);
        assert.equal(again.body.error.code, "ALREADY_REPORTED");
        assert.equal(await Report.count({ where: { reporterId: reader.user.id, targetKey: `comment:${written.id}` } }), 1);
    });

    it("lets a second person report the same thing", async () => {
        const third = await registerAndLogin({ role: "user" });

        assert.equal((await report(third, { targetType: "comment", targetId: written.id, reason: "spam" })).status, 201);
    });

    it("refuses reports about your own comment, your own story or yourself", async () => {
        for (const [who, body] of [
            [other, { targetType: "comment", targetId: written.id, reason: "spam" }],
            [editor, { targetType: "post", targetId: story.id, reason: "spam" }],
            [reader, { targetType: "user", targetId: name(reader), reason: "spam" }],
        ]) {
            const response = await report(who, body);
            assert.equal(response.status, 400);
            assert.equal(response.body.error.code, "CANNOT_REPORT_OWN");
        }
    });

    it("answers 404 for anything the public cannot see, without saying why", async () => {
        const fresh = await registerAndLogin({ role: "user" });
        const hidden = (await publish(editor, "About to hide")).body.data.post;
        const onHidden = (await comment(other, hidden.id, "On a story that goes away")).body.data.comment;
        const gone = (await comment(other, story.id, "Deleted soon")).body.data.comment;
        await request(app).delete(`/api/comments/${gone.id}`).set(bearer(other.token));
        await request(app).post(`/api/posts/${hidden.id}/status`).set(bearer(editor.token)).send({ to: "archived" });
        const draft = (await request(app).post("/api/posts").set(bearer(editor.token)).send({ title: "Draft", content: "<p>x</p>" })).body.data.post;
        const suspended = await registerAndLogin({ role: "user" });
        await User.update({ status: "suspended" }, { where: { id: suspended.user.id } });

        for (const body of [
            { targetType: "post", targetId: hidden.id },
            { targetType: "post", targetId: draft.id },
            { targetType: "post", targetId: 999999 },
            { targetType: "comment", targetId: onHidden.id },
            { targetType: "comment", targetId: gone.id },
            { targetType: "comment", targetId: 999999 },
            { targetType: "user", targetId: name(suspended) },
            { targetType: "user", targetId: "nobody_here" },
        ]) {
            assert.equal((await report(fresh, { ...body, reason: "spam" })).status, 404, JSON.stringify(body));
        }
    });

    it("needs a login and a confirmed email address", async () => {
        const unconfirmed = await registerAndLogin({ role: "user", verified: false });
        const body = { targetType: "comment", targetId: written.id, reason: "spam" };

        assert.equal((await report(null, body)).status, 401);
        const refused = await report(unconfirmed, body);
        assert.equal(refused.status, 403);
        assert.equal(refused.body.error.code, "EMAIL_NOT_VERIFIED");
    });

    it("validates the request", async () => {
        const fresh = await registerAndLogin({ role: "user" });
        const ok = { targetType: "comment", targetId: written.id, reason: "spam" };

        for (const bad of [
            { ...ok, reason: "boring" },
            { ...ok, targetType: "image" },
            { ...ok, details: "x".repeat(501) },
            { ...ok, targetId: "12" },
            { ...ok, targetType: "user", targetId: 12 },
            { targetType: "comment", reason: "spam" },
            {},
        ]) {
            assert.equal((await report(fresh, bad)).status, 400, JSON.stringify(bad).slice(0, 70));
        }
        assert.equal((await report(fresh, { ...ok, details: "   " })).status, 201, "empty details are fine");
        assert.equal((await Report.findOne({ where: { reporterId: fresh.user.id } })).details, null);
    });

    it("limits how many reports one person can file in an hour", async () => {
        const busy = await registerAndLogin({ role: "user" });
        await Report.bulkCreate(
            Array.from({ length: MAX_REPORTS_PER_HOUR }, (_, i) => ({ reporterId: busy.user.id, targetType: "comment", commentId: written.id, targetKey: `comment:filler${i}`, reason: "spam" })),
        );

        const refused = await report(busy, { targetType: "post", targetId: story.id, reason: "spam" });

        assert.equal(refused.status, 429);
    });
});

describe("the moderation queue", () => {
    let admin;
    let editor;
    let author;
    let r1;
    let r2;
    let story;
    let c1;
    let c2;

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        editor = await registerAndLogin({ role: "editor" });
        author = await registerAndLogin({ role: "editor" });
        r1 = await registerAndLogin({ role: "user" });
        r2 = await registerAndLogin({ role: "user" });
        story = (await publish(author, "A story under review")).body.data.post;
        c1 = (await comment(author, story.id, "The first reported comment, said rudely")).body.data.comment;
        c2 = (await comment(author, story.id, "The second reported comment")).body.data.comment;
        await report(r1, { targetType: "comment", targetId: c1.id, reason: "spam", details: "first note" });
        await report(r2, { targetType: "comment", targetId: c1.id, reason: "harassment", details: "second note" });
        await report(r1, { targetType: "comment", targetId: c2.id, reason: "other" });
        await report(r1, { targetType: "post", targetId: story.id, reason: "misinformation" });
        await report(r1, { targetType: "user", targetId: name(author), reason: "harassment" });
    });

    it("shows each reported thing once, with how many people reported it and why", async () => {
        const response = await queue(admin);

        assert.equal(response.status, 200);
        const commentItem = response.body.data.reports.find(aboutComment(c1.id));
        assert.equal(commentItem.targetType, "comment");
        assert.equal(commentItem.reportCount, 2);
        assert.deepEqual(commentItem.reasons.map((r) => [r.reason, r.label, r.count]).sort(), [["harassment", "Harassment or bullying", 1], ["spam", "Spam or advertising", 1]]);
        assert.equal(response.body.data.reports.length, 4, "two comments, one story, one person: four targets, five reports");
        assert.equal(response.body.meta.pagination.total, 4);
    });

    it("describes what was reported, as plain text, with where it is", async () => {
        const items = (await queue(admin)).body.data.reports;
        const commentItem = items.find(aboutComment(c1.id));
        const storyItem = items.find((item) => item.targetType === "post");
        const personItem = items.find((item) => item.targetType === "user");

        assert.equal(commentItem.target.excerpt, "The first reported comment, said rudely");
        assert.equal(commentItem.target.post.title, "A story under review");
        assert.equal(commentItem.target.author.username, name(author));
        assert.deepEqual([storyItem.target.title, storyItem.target.status, storyItem.target.author.username], ["A story under review", "published", name(author)]);
        assert.deepEqual([personItem.target.username, personItem.target.status], [name(author), "active"]);
    });

    it("keeps reports about people for admins: editors never see them", async () => {
        const forEditor = (await queue(editor)).body.data.reports;

        assert.equal(forEditor.length, 3);
        assert.ok(forEditor.every((item) => item.targetType !== "user"));
        assert.equal((await queue(editor, "?type=user")).body.data.reports.length, 0);
        assert.equal((await queue(admin, "?type=user")).body.data.reports.length, 1);
        assert.equal((await queue(admin, "?type=comment")).body.data.reports.length, 2);
        const personReport = (await queue(admin, "?type=user")).body.data.reports[0];
        assert.equal((await detail(editor, personReport.id)).status, 404);
        assert.equal((await detail(admin, personReport.id)).status, 200);
    });

    it("pages through the queue", async () => {
        const first = await queue(admin, "?limit=3");
        const second = await queue(admin, "?limit=3&page=2");

        assert.equal(first.body.data.reports.length, 3);
        assert.equal(second.body.data.reports.length, 1);
        assert.deepEqual(first.body.meta.pagination, { page: 1, limit: 3, total: 4, totalPages: 2 });
        assert.equal(new Set([...first.body.data.reports, ...second.body.data.reports].map((item) => item.id)).size, 4);
    });

    it("shows a moderator every report about one thing, with who filed it and what they wrote", async () => {
        const item = (await queue(editor)).body.data.reports.find(aboutComment(c1.id));

        const response = await detail(editor, item.id);

        assert.equal(response.status, 200);
        const { reports } = response.body.data.report;
        assert.deepEqual(reports.map((r) => [r.reporter.username, r.reason, r.details]).sort(), [[name(r1), "spam", "first note"], [name(r2), "harassment", "second note"]].sort());
    });

    it("is closed to readers and to anyone not logged in, and answers 404 for missing or non-numeric reports", async () => {
        assert.equal((await queue(null)).status, 401);
        assert.equal((await queue(r1)).status, 403);
        assert.equal((await detail(r1, 1)).status, 403);
        assert.equal((await resolve(r1, 1, { action: "dismiss" })).status, 403);
        assert.equal((await detail(editor, 999999)).status, 404);
        assert.equal((await request(app).get("/api/moderation/reports/abc").set(bearer(editor.token))).status, 404);
    });

    it("never reveals a reporter outside the queue", async () => {
        const publicComments = JSON.stringify((await request(app).get(`/api/posts/${story.id}/comments`).set(bearer(author.token))).body);

        assert.ok(!publicComments.includes(name(r1)) && !publicComments.includes("first note"));
    });
});

describe("deciding about reports", () => {
    let admin;
    let editor;
    let author;
    let commenter;
    let reader;
    let reader2;
    let story;

    before(resetDatabase);
    before(async () => {
        admin = await registerAndLogin({ role: "admin" });
        editor = await registerAndLogin({ role: "editor" });
        author = await registerAndLogin({ role: "editor" });
        commenter = await registerAndLogin({ role: "user" });
        reader = await registerAndLogin({ role: "user" });
        reader2 = await registerAndLogin({ role: "user" });
        story = (await publish(author, "Moderated story")).body.data.post;
    });

    const reported = async (body, reporters = [reader]) => {
        const written = (await comment(commenter, story.id, body)).body.data.comment;
        for (const who of reporters) await report(who, { targetType: "comment", targetId: written.id, reason: "spam" });
        return { written, item: (await queue(editor)).body.data.reports.find(aboutComment(written.id)) };
    };

    it("dismisses a report without a note, closing every report about it and changing nothing else", async () => {
        const { written, item } = await reported("Fine, actually", [reader, reader2]);

        const response = await resolve(editor, item.id, { action: "dismiss" });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.report.status, "dismissed");
        assert.equal(response.body.data.report.handled.by, name(editor));
        assert.equal(await Report.count({ where: { targetKey: `comment:${written.id}`, status: "open" } }), 0);
        assert.equal((await Comment.findByPk(written.id)).deletedAt, null);
        assert.ok(!(await queue(editor)).body.data.reports.some(aboutComment(written.id)));
        const resolved = (await queue(editor, "?status=resolved")).body.data.reports.find(aboutComment(written.id));
        assert.deepEqual([resolved.handled.outcome, resolved.reportCount], ["dismissed", 2]);
    });

    it("needs a note for anything but a dismissal, and rejects actions that do not fit the target", async () => {
        const { item } = await reported("Needs a decision");

        assert.equal((await resolve(editor, item.id, { action: "remove" })).status, 400);
        assert.equal((await resolve(editor, item.id, { action: "remove", note: "   " })).status, 400);
        assert.equal((await resolve(editor, item.id, { action: "unpublish", note: "x" })).status, 400, "a comment cannot be unpublished");
        assert.equal((await resolve(editor, item.id, { action: "suspend", note: "x" })).status, 400);
        assert.equal((await resolve(editor, item.id, { action: "delete", note: "x" })).status, 400);
        assert.equal((await resolve(editor, item.id, { action: "remove", note: "x".repeat(501) })).status, 400);
        assert.equal((await Report.findByPk(item.id)).status, "open");
    });

    it("removes a comment: it disappears, every report is closed together, the audit trail has the note, and its author is told", async () => {
        const { written, item } = await reported("Buy cheap pills now", [reader, reader2]);
        clearSentEmails();

        const response = await resolve(editor, item.id, { action: "remove", note: "This is an advert, which we do not allow." });
        await settleJobs();

        assert.equal(response.status, 200);
        assert.equal(response.body.data.report.status, "actioned");
        const row = await Comment.findByPk(written.id);
        assert.deepEqual([row.body, Boolean(row.deletedAt)], [null, true]);
        assert.equal(await Report.count({ where: { targetKey: `comment:${written.id}`, status: "actioned" } }), 2);

        const removal = await AuditLog.findOne({ where: { action: "comment.deleted_by_other", entityId: String(written.id) } });
        assert.deepEqual([removal.actorId, removal.metadata.as, removal.metadata.note], [editor.user.id, "moderator", "This is an advert, which we do not allow."]);
        const decision = await AuditLog.findOne({ where: { action: "report.resolved", entityId: String(item.id) } });
        assert.deepEqual([decision.metadata.action, decision.metadata.reports], ["remove", 2]);
        assert.ok(!JSON.stringify([removal.metadata, decision.metadata]).includes("Buy cheap pills"), "the removed words are not kept in the trail");

        const notice = (await request(app).get("/api/notifications").set(bearer(commenter.token))).body.data.notifications.find((n) => n.type === "comment_removed");
        assert.equal(notice.note, "This is an advert, which we do not allow.");
        assert.equal(notice.post.title, "Moderated story");
        assert.equal(notice.comment, null, "the removed words are not shown again");
        assert.equal(notice.actor.username, name(editor));
        const mail = sentEmails.find((m) => m.to === commenter.credentials.email && /removed/.test(m.subject));
        assert.ok(mail.text.includes("This is an advert, which we do not allow."));
    });

    it("unpublishes a story by the usual rules, with the note, and tells its author", async () => {
        const target = (await publish(author, "A story to take down")).body.data.post;
        await report(reader, { targetType: "post", targetId: target.id, reason: "copyright" });
        const item = (await queue(editor)).body.data.reports.find((entry) => entry.targetType === "post" && entry.target?.id === target.id);
        clearSentEmails();

        assert.equal((await resolve(editor, item.id, { action: "unpublish" })).status, 400, "a reason is needed");
        const response = await resolve(editor, item.id, { action: "unpublish", note: "Copied from another site." });
        await settleJobs();

        assert.equal(response.status, 200);
        assert.equal((await request(app).get(`/api/posts/${target.id}`)).status, 404, "no longer public");
        const status = await AuditLog.findOne({ where: { action: "post.status_changed", entityId: String(target.id) }, order: [["id", "DESC"]] });
        assert.deepEqual([status.metadata.from, status.metadata.to, status.metadata.reason], ["published", "archived", "Copied from another site."]);
        const notice = (await request(app).get("/api/notifications").set(bearer(author.token))).body.data.notifications.find((n) => n.type === "post_unpublished" && n.post.id === target.id);
        assert.equal(notice.note, "Copied from another site.");
        assert.ok(sentEmails.some((m) => m.to === author.credentials.email && /taken down/.test(m.subject) && m.text.includes("Copied from another site.")));
    });

    it("lets only an admin decide about a person, and an admin can suspend them from the queue", async () => {
        const troublemaker = await registerAndLogin({ role: "user" });
        await report(reader, { targetType: "user", targetId: name(troublemaker), reason: "harassment" });
        const item = (await queue(admin, "?type=user")).body.data.reports.find((entry) => entry.target?.username === name(troublemaker));

        assert.equal((await resolve(editor, item.id, { action: "suspend", note: "x" })).status, 404, "editors cannot even see it");
        assert.equal((await resolve(admin, item.id, { action: "suspend" })).status, 400);
        const response = await resolve(admin, item.id, { action: "suspend", note: "Repeated harassment of other readers." });

        assert.equal(response.status, 200);
        const row = await User.findByPk(troublemaker.user.id);
        assert.deepEqual([row.status, row.suspendedReason], ["suspended", "Repeated harassment of other readers."]);
        assert.equal((await request(app).get("/api/auth/me").set(bearer(troublemaker.token))).status, 401);
    });

    it("answers 409 to a second decision, and when two moderators decide at the same moment only one counts", async () => {
        const { item } = await reported("Contested", [reader, reader2]);

        const [first, second] = await Promise.all([resolve(editor, item.id, { action: "remove", note: "one" }), resolve(admin, item.id, { action: "remove", note: "two" })]);

        assert.deepEqual([first.status, second.status].sort(), [200, 409]);
        assert.equal(await AuditLog.count({ where: { action: "report.resolved", entityId: String(item.id) } }), 1);
        assert.equal((await resolve(editor, item.id, { action: "dismiss" })).status, 409);
    });

    it("still closes the reports when the comment was already deleted by its author", async () => {
        const { written, item } = await reported("I changed my mind");
        await request(app).delete(`/api/comments/${written.id}`).set(bearer(commenter.token));

        const response = await resolve(editor, item.id, { action: "remove", note: "Removing it." });

        assert.equal(response.status, 200);
        assert.equal(await AuditLog.count({ where: { action: "comment.deleted_by_other", entityId: String(written.id) } }), 0, "nothing was removed by the moderator");
    });

    it("keeps notes as plain text", async () => {
        const { item } = await reported("Another one");
        const note = "<script>alert(1)</script> & more";

        const response = await resolve(editor, item.id, { action: "remove", note });

        assert.equal(response.body.data.report.handled.note, note);
    });

    it("tells a comment's author when the story's author removes it, with an optional note", async () => {
        const written = (await comment(commenter, story.id, "Off topic")).body.data.comment;
        await request(app).delete(`/api/comments/${written.id}`).set(bearer(author.token)).send({ note: "Please keep to the subject." });
        const own = (await comment(commenter, story.id, "Mine to delete")).body.data.comment;
        await request(app).delete(`/api/comments/${own.id}`).set(bearer(commenter.token));
        await settleJobs();

        const notices = (await request(app).get("/api/notifications").set(bearer(commenter.token))).body.data.notifications.filter((n) => n.type === "comment_removed");

        assert.ok(notices.some((n) => n.note === "Please keep to the subject." && n.actor.username === name(author)));
        assert.equal(await Notification.count({ where: { recipientId: commenter.user.id, commentId: own.id } }), 0, "deleting your own comment tells nobody");
    });

    it("requires a reason to take down someone else's story, and tells no one when an author withdraws their own", async () => {
        const mine = (await publish(author, "Author's own story")).body.data.post;
        const move = (who, to, reason) => request(app).post(`/api/posts/${mine.id}/status`).set(bearer(who.token)).send({ to, ...(reason && { reason }) });

        assert.equal((await move(editor, "archived")).status, 400);
        assert.equal((await move(editor, "draft")).status, 400);
        assert.equal((await move(editor, "archived", "Out of date.")).status, 200);
        assert.equal((await move(author, "draft")).status, 200, "the author needs no reason");
        await settleJobs();
        assert.equal(await Notification.count({ where: { recipientId: author.user.id, type: "post_unpublished", postId: mine.id } }), 1, "only the take-down by another person");
    });

    it("includes the two new kinds in each person's choices, on by default", async () => {
        const prefs = (await request(app).get("/api/notifications/preferences").set(bearer(reader.token))).body.data.preferences;

        for (const type of ["comment_removed", "post_unpublished"]) {
            const choice = prefs.find((p) => p.type === type);
            assert.deepEqual([choice.inApp, choice.email], [true, true], type);
        }
    });
});
