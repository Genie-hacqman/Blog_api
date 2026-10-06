import sanitizeHtml from "sanitize-html";
import { Parser } from "htmlparser2";
import { MAX_NESTING_DEPTH } from "../config/posts.js";
import { ValidationError } from "./AppError.js";

// The only place post HTML is handled. Rich content enters the system through sanitizeContent()
// and nowhere else: what is stored, searched, excerpted and sent to readers is its output.

const ALLOWED_TAGS = ["p", "br", "h2", "h3", "h4", "strong", "em", "s", "code", "pre", "blockquote", "ul", "ol", "li", "hr", "a", "img"];
const CODE_CLASS = /^language-[a-z0-9+#-]+$/;
// the only attribute values we keep on links, so a forced rel can never be dropped by an editor
const LINK_REL = "noopener noreferrer nofollow ugc";

const SANITIZE_OPTIONS = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
        a: ["href", "rel"],
        img: ["src", "alt", "width", "height", "loading"],
        code: ["class"],
    },
    allowedClasses: { code: [CODE_CLASS] },
    // no javascript:, data:, vbscript:, file: ... and no protocol-relative "//host" links
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    // text inside a removed tag is kept (except script/style/textarea/...: those are dropped entirely)
    disallowedTagsMode: "discard",
    // an image whose source was refused (data:, javascript: ...) is removed, not left empty
    exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
    transformTags: {
        h1: "h2",
        h5: "h4",
        h6: "h4",
        a: (tagName, attribs) => ({ tagName, attribs: { ...(attribs.href !== undefined && { href: attribs.href }), rel: LINK_REL } }),
        img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    },
};

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plain text becomes paragraphs: a blank line starts a new one, a single line break stays a <br>.
export const plainTextToHtml = (text) =>
    String(text ?? "")
        .replace(/\r\n?/g, "\n")
        .trim()
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("");

// something with at least one tag in it; "a < b" and "2 > 1" are still plain text
const LOOKS_LIKE_HTML = /<\/?[a-z][^>]*>/i;

// how deeply the elements nest (a document made of thousands of nested elements is an attack, not an article)
const nestingDepth = (html) => {
    let depth = 0;
    let deepest = 0;
    const parser = new Parser({
        onopentag: () => {
            depth += 1;
            deepest = Math.max(deepest, depth);
        },
        onclosetag: () => {
            depth -= 1;
        },
    });
    parser.write(html);
    parser.end();
    return deepest;
};

// Returns safe HTML: only the allowlisted tags and attributes, links forced to rel="noopener noreferrer nofollow ugc".
// Text with no markup is wrapped into paragraphs first, so API clients that send plain text keep working.
export const sanitizeContent = (input) => {
    const source = String(input ?? "");
    const html = LOOKS_LIKE_HTML.test(source) ? source : plainTextToHtml(source);
    // empty paragraphs are spacing, not content (editors leave one after a block); layout is the stylesheet's job
    let clean = sanitizeHtml(html, SANITIZE_OPTIONS).replace(/<p>\s*<\/p>/g, "");
    // Bare text left over after cleaning (everything else was removed) is wrapped, so stored content always
    // contains markup and a later pass never mistakes already-escaped text for plain text and escapes it twice.
    if (clean && !LOOKS_LIKE_HTML.test(clean)) clean = `<p>${clean}</p>`;
    if (nestingDepth(clean) > MAX_NESTING_DEPTH) {
        throw new ValidationError("content is nested too deeply");
    }
    return clean;
};

// ---------- reading HTML back out ----------

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "ul", "ol", "div", "table", "tr"]);
const SKIPPED_TAGS = new Set(["script", "style"]);
const MARKERS = { h2: "## ", h3: "### ", h4: "#### ", li: "- ", blockquote: "> " };

// The text of a document as a list of blocks (one per paragraph, heading, list item ...). With
// `markers`, a block's kind is kept as a short prefix ("## ", "- ", "> ") and images and rules are
// listed, which is what a change history needs to show.
const toBlocks = (html, { markers = false } = {}) => {
    const blocks = [];
    let buffer = "";
    let prefix = "";
    let skipping = 0;
    let inPre = 0;

    const flush = () => {
        const text = inPre
            ? buffer.replace(/^\n+|\n+$/g, "")
            : buffer.replace(/[ \t\f\v\r]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
        if (text) {
            blocks.push(markers ? prefix + text : text);
            prefix = "";
        }
        buffer = "";
    };

    const parser = new Parser({
        onopentag(name, attributes) {
            if (SKIPPED_TAGS.has(name)) skipping += 1;
            if (skipping) return;
            if (BLOCK_TAGS.has(name)) {
                flush();
                if (markers && MARKERS[name]) prefix = MARKERS[name];
            }
            if (name === "pre") inPre += 1;
            if (name === "br") buffer += "\n";
            if (markers && name === "hr") {
                flush();
                blocks.push("---");
            }
            if (markers && name === "img") {
                flush();
                blocks.push(attributes.alt ? `[image: ${attributes.alt}]` : "[image]");
            }
        },
        ontext(text) {
            if (!skipping) buffer += text;
        },
        onclosetag(name) {
            if (SKIPPED_TAGS.has(name)) {
                skipping -= 1;
                return;
            }
            if (skipping) return;
            if (BLOCK_TAGS.has(name)) {
                flush();
                prefix = "";
            }
            if (name === "pre") inPre -= 1;
        },
    });
    parser.write(String(html ?? ""));
    parser.end();
    flush();
    return blocks;
};

// The readable text of a post on one line: what excerpts, reading time, search and the "is it empty?"
// check work from. Markup, attributes and URLs are not part of it; entities are decoded.
export const htmlToText = (html) => toBlocks(html).join(" ").replace(/\s+/g, " ").trim();

// One line per block, for the change history. Blocks of the same kind line up, so a diff reads naturally.
export const htmlToDiffText = (html) => toBlocks(html, { markers: true }).join("\n");

// Paragraphs separated by blank lines: the inverse of plainTextToHtml (used to undo the migration).
export const htmlToPlainText = (html) => toBlocks(html).join("\n\n");

// every <img src> in a document, in order, without repeats
export const extractImageSrcs = (html) => {
    const sources = new Set();
    const parser = new Parser({
        onopentag(name, attributes) {
            if (name === "img" && attributes.src) sources.add(attributes.src);
        },
    });
    parser.write(String(html ?? ""));
    parser.end();
    return [...sources];
};

// Remove images (by src) from sanitized HTML: used when a restored revision points at files that no longer exist.
export const removeImages = (html, shouldRemove) =>
    sanitizeHtml(html, {
        ...SANITIZE_OPTIONS,
        // already sanitized: keep it as is, apart from the images that go
        transformTags: {},
        exclusiveFilter: (frame) => frame.tag === "img" && (!frame.attribs.src || shouldRemove(frame.attribs.src)),
    });
