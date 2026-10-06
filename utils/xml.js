// Small helpers for building XML (sitemaps and feeds) without a library. Everything that is not markup we wrote
// ourselves goes through escapeXml.

// characters XML 1.0 cannot contain at all (control characters, lone surrogates, U+FFFE/F)
const NOT_ALLOWED = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu;

export const escapeXml = (value) =>
    String(value ?? "")
        .replace(NOT_ALLOWED, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

const attributesOf = (attributes) =>
    Object.entries(attributes)
        .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
        .join("");

// <name attr="...">escaped text</name>
export const textElement = (name, text, attributes = {}) => `<${name}${attributesOf(attributes)}>${escapeXml(text)}</${name}>`;

// <name attr="..." /> (no content)
export const emptyElement = (name, attributes = {}) => `<${name}${attributesOf(attributes)}/>`;

// <name>already built child markup</name>
export const groupElement = (name, children, attributes = {}) => `<${name}${attributesOf(attributes)}>${children.join("")}</${name}>`;

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
