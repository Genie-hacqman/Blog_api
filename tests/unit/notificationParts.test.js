import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { JWT_AUDIENCE, JWT_ISSUER } from "../../config/auth.js";
import { NOTIFICATION_TYPES, TYPE_NAMES, UNSUBSCRIBE_AUDIENCE } from "../../config/notifications.js";
import { notificationTemplate } from "../../providers/email/templates.js";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "../../utils/unsubscribeToken.js";

describe("notification kinds", () => {
    it("each has a label and a default for both channels", () => {
        assert.ok(TYPE_NAMES.length >= 6);
        for (const type of TYPE_NAMES) {
            const kind = NOTIFICATION_TYPES[type];
            assert.ok(kind.label.length > 0, type);
            assert.equal(typeof kind.inApp, "boolean", type);
            assert.equal(typeof kind.email, "boolean", type);
        }
    });

    it("only the quiet kinds are off for email by default", () => {
        const emailOff = TYPE_NAMES.filter((type) => !NOTIFICATION_TYPES[type].email).sort();
        assert.deepEqual(emailOff, ["new_follower", "post_submitted"]);
    });
});

describe("unsubscribe tokens", () => {
    it("round-trips a kind and a person", () => {
        assert.deepEqual(verifyUnsubscribeToken(signUnsubscribeToken(42, "comment_reply")), { userId: 42, scope: "comment_reply" });
        assert.deepEqual(verifyUnsubscribeToken(signUnsubscribeToken(7, "all")), { userId: 7, scope: "all" });
    });

    it("rejects garbage, a changed token, a token for another secret, and an unknown kind", () => {
        const good = signUnsubscribeToken(42, "comment_reply");
        const tampered = `${good.slice(0, -2)}${good.endsWith("AA") ? "BB" : "AA"}`;
        const otherSecret = jwt.sign({ scope: "all" }, "another secret", { subject: "1", audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER });
        const unknownKind = jwt.sign({ scope: "post:delete" }, env.JWT_SECRET, { subject: "1", audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER });

        for (const token of [undefined, "", "not.a.token", "abc", tampered, otherSecret, unknownKind]) {
            assert.equal(verifyUnsubscribeToken(token), null, String(token).slice(0, 30));
        }
    });

    it("rejects an expired token and a token without a person", () => {
        const expired = jwt.sign({ scope: "all" }, env.JWT_SECRET, { subject: "1", audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER, expiresIn: -10 });
        const anonymous = jwt.sign({ scope: "all" }, env.JWT_SECRET, { audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER });
        const strange = jwt.sign({ scope: "all" }, env.JWT_SECRET, { subject: "not-a-number", audience: UNSUBSCRIBE_AUDIENCE, issuer: JWT_ISSUER });

        for (const token of [expired, anonymous, strange]) assert.equal(verifyUnsubscribeToken(token), null);
    });

    it("cannot be used as an access token, and an access token cannot unsubscribe", () => {
        const access = jwt.sign({ sid: "x" }, env.JWT_SECRET, { subject: "1", audience: JWT_AUDIENCE, issuer: JWT_ISSUER, algorithm: "HS256" });
        assert.equal(verifyUnsubscribeToken(access), null);

        const unsubscribe = signUnsubscribeToken(1, "all");
        assert.throws(() => jwt.verify(unsubscribe, env.JWT_SECRET, { audience: JWT_AUDIENCE, issuer: JWT_ISSUER }), /audience/);
    });
});

describe("the notification email", () => {
    const base = { firstName: "Ada", headline: "Bob commented on “A title”", detail: "Nice one", url: "https://blog.example/blog/a-title#comments", unsubscribeUrl: "https://blog.example/unsubscribe?token=abc", unsubscribeLabel: "Comments on your stories" };

    it("says what happened, where to look, and how to stop these emails, in text and HTML", () => {
        const message = notificationTemplate(base);

        assert.equal(message.subject, "Bob commented on “A title”");
        for (const part of [message.text, message.html]) {
            assert.ok(part.includes("Nice one"));
            assert.ok(part.includes("https://blog.example/blog/a-title#comments"));
            assert.ok(part.includes("https://blog.example/unsubscribe?token=abc"));
        }
        assert.ok(message.text.includes("Comments on your stories"));
    });

    it("escapes everything a person typed in the HTML", () => {
        const message = notificationTemplate({ ...base, firstName: "<b>Ada</b>", headline: 'Bob said <script>alert("x")</script>', detail: "<img src=x onerror=alert(1)> & more", unsubscribeLabel: "<i>kind</i>" });

        assert.ok(!/<script|<img|<b>|<i>/i.test(message.html), message.html);
        assert.ok(message.html.includes("&lt;img src=x onerror=alert(1)&gt; &amp; more"));
    });

    it("keeps the subject on one line whatever the headline holds, and short", () => {
        const message = notificationTemplate({ ...base, headline: `Bob commented on “Hello\r\nBcc: evil@example.com\u0000”${"x".repeat(400)}` });

        assert.ok([...message.subject].every((char) => char.codePointAt(0) >= 32), JSON.stringify(message.subject));
        assert.ok(message.subject.length <= 150);
    });

    it("leaves out the quote block when there is no detail", () => {
        assert.ok(!notificationTemplate({ ...base, detail: undefined }).html.includes("<blockquote"));
    });
});
