import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { availableTransitions, evaluateTransition } from "../../policies/postWorkflow.js";
import { canViewPost, canViewRevisions } from "../../policies/postPolicy.js";
import { env } from "../../config/env.js";
import { POST_STATUSES } from "../../config/posts.js";

const author = { id: 1, role: "author" };
const otherAuthor = { id: 2, role: "author" };
const editorWhoOwns = { id: 3, role: "editor" };
const otherEditor = { id: 4, role: "editor" };
const admin = { id: 5, role: "admin" };
const reader = { id: 6, role: "user" };

const postOf = (status, owner) => ({ status, userId: owner.id });

// The allowed moves, written out independently of the implementation: who may move a post
// from one status to another. Everything not listed must be refused.
const allowed = (spec) => new Set(Object.entries(spec).flatMap(([from, tos]) => tos.map((to) => `${from}>${to}`)));

const REVIEW_ON = {
    // the author of the post
    author: allowed({
        draft: ["pending_review", "private"],
        pending_review: ["draft"],
        rejected: ["pending_review", "draft"],
        scheduled: ["draft"],
        published: ["draft", "archived", "private"],
        archived: ["draft", "private"],
        private: ["draft", "pending_review"],
    }),
    // another author: nothing
    otherAuthor: allowed({}),
    // an editor who wrote the post: the owner's moves plus publishing, but never reviewing their own work
    editorWhoOwns: allowed({
        draft: ["pending_review", "published", "scheduled", "private"],
        pending_review: ["draft"],
        rejected: ["pending_review", "draft", "published", "scheduled"],
        scheduled: ["draft", "published", "scheduled"],
        published: ["draft", "archived", "private"],
        archived: ["draft", "published", "private"],
        private: ["draft", "pending_review", "published", "scheduled"],
    }),
    // an editor looking at someone else's post sees only the review and moderation states
    otherEditor: allowed({
        pending_review: ["published", "scheduled", "rejected"],
        rejected: ["published", "scheduled"],
        scheduled: ["draft", "published", "scheduled"],
        published: ["draft", "archived"],
        archived: ["published"],
    }),
    reader: allowed({}),
};
REVIEW_ON.admin = REVIEW_ON.otherEditor;

describe("post workflow: transition table (review required)", () => {
    const cases = [
        ["the author", author, author, REVIEW_ON.author],
        ["another author", otherAuthor, author, REVIEW_ON.otherAuthor],
        ["an editor who owns the post", editorWhoOwns, editorWhoOwns, REVIEW_ON.editorWhoOwns],
        ["another editor", otherEditor, author, REVIEW_ON.otherEditor],
        ["an admin", admin, author, REVIEW_ON.admin],
        ["a plain reader", reader, author, REVIEW_ON.reader],
    ];

    for (const [name, actor, owner, expected] of cases) {
        it(`${name}: every move is allowed or refused exactly as specified`, () => {
            for (const from of POST_STATUSES) {
                for (const to of POST_STATUSES) {
                    const verdict = evaluateTransition(actor, postOf(from, owner), to);
                    assert.equal(verdict.ok, expected.has(`${from}>${to}`), `${name}: ${from} -> ${to} should be ${expected.has(`${from}>${to}`) ? "allowed" : "refused"} (got ${JSON.stringify(verdict)})`);
                }
            }
        });
    }
});

describe("post workflow: review switched off", () => {
    afterEach(() => {
        env.REQUIRE_POST_REVIEW = true;
    });

    it("lets authors publish and schedule their own posts directly, and nobody else's", () => {
        env.REQUIRE_POST_REVIEW = false;

        for (const from of ["draft", "rejected", "scheduled", "private", "archived"]) {
            assert.ok(evaluateTransition(author, postOf(from, author), "published").ok, `${from} -> published should be open to the author`);
        }
        assert.ok(evaluateTransition(author, postOf("draft", author), "scheduled").ok);
        assert.ok(evaluateTransition(author, postOf("private", author), "published").ok);
        assert.ok(!evaluateTransition(otherAuthor, postOf("published", author), "archived").ok);
        assert.ok(!evaluateTransition(otherAuthor, postOf("draft", author), "published").ok);
    });

    it("never lets an editor approve their own post, even then", () => {
        env.REQUIRE_POST_REVIEW = false;

        assert.ok(!evaluateTransition(editorWhoOwns, postOf("pending_review", editorWhoOwns), "published").ok);
    });
});

describe("post workflow: reasons", () => {
    it("explains that an author's own post needs review", () => {
        const verdict = evaluateTransition(author, postOf("draft", author), "published");

        assert.deepEqual([verdict.status, verdict.code], [403, "REVIEW_REQUIRED"]);
    });

    it("reports an impossible move as a conflict, not a permission problem", () => {
        const verdict = evaluateTransition(author, postOf("published", author), "pending_review");

        assert.deepEqual([verdict.status, verdict.code], [409, "INVALID_TRANSITION"]);
        assert.match(verdict.message, /published cannot be moved to pending review/);
    });

    it("answers 404 for a post the user cannot see, whatever they ask for", () => {
        for (const to of POST_STATUSES) {
            const verdict = evaluateTransition(otherAuthor, postOf("draft", author), to);
            assert.deepEqual([verdict.status, verdict.code], [404, "NOT_FOUND"]);
        }
    });

    it("rejects an unknown status", () => {
        assert.equal(evaluateTransition(author, postOf("draft", author), "deleted").status, 400);
    });

    it("lists only the moves open to the viewer", () => {
        assert.deepEqual(availableTransitions(author, postOf("draft", author), ).sort(), ["pending_review", "private"]);
        assert.deepEqual(availableTransitions(otherEditor, postOf("pending_review", author)).sort(), ["published", "rejected", "scheduled"]);
        assert.deepEqual(availableTransitions(reader, postOf("published", author)), []);
    });
});

describe("post visibility", () => {
    const view = (viewer, status) => canViewPost(viewer, postOf(status, author));
    const visibleTo = (viewer) => POST_STATUSES.filter((status) => view(viewer, status));

    it("published is public; the rest depends on who is looking", () => {
        assert.deepEqual(visibleTo(null), ["published"]);
        assert.deepEqual(visibleTo(reader), ["published"]);
        assert.deepEqual(visibleTo(otherAuthor), ["published"]);
        assert.deepEqual(visibleTo(author).sort(), [...POST_STATUSES].sort());
        // editors and admins see what they review and moderate, never other people's drafts or private posts
        assert.deepEqual(visibleTo(otherEditor).sort(), ["archived", "pending_review", "published", "rejected", "scheduled"]);
        assert.deepEqual(visibleTo(admin).sort(), ["archived", "pending_review", "published", "rejected", "scheduled"]);
    });

    it("shows history to the author and to editors who can see the post, never to anonymous visitors", () => {
        assert.equal(canViewRevisions(author, postOf("draft", author)), true);
        assert.equal(canViewRevisions(otherEditor, postOf("pending_review", author)), true);
        assert.equal(canViewRevisions(otherEditor, postOf("draft", author)), false);
        assert.equal(canViewRevisions(otherAuthor, postOf("published", author)), false);
        assert.equal(canViewRevisions(null, postOf("published", author)), false);
    });
});
