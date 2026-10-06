import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, resetPasswordTemplate, verifyEmailTemplate } from "../../providers/email/templates.js";

describe("email templates", () => {
    it("escapes HTML special characters", () => {
        assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    });

    it("puts the token in a link to the frontend and URL-encodes it", () => {
        const { text, html } = verifyEmailTemplate({ firstName: "Ada", token: "a+b/c=" });

        assert.match(text, /\/verify-email\?token=a%2Bb%2Fc%3D/);
        assert.match(html, /verify-email\?token=a%2Bb%2Fc%3D/);
    });

    it("never lets a name inject markup into the HTML body", () => {
        const { html } = resetPasswordTemplate({ firstName: `"><img src=x onerror=alert(1)>`, token: "t" });

        assert.ok(!html.includes("<img"));
    });
});
