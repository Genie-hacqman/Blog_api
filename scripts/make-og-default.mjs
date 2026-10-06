// One-off: draws the picture used in link previews when a page has no picture of its own (1200 x 630) and writes
// it to the frontend's public/ folder. Run again only when the publication is renamed:
//   node scripts/make-og-default.mjs "Genie's Entry" "Essays, notes & dispatches"
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const [name = "Genie's Entry", tagline = "Essays, notes & dispatches"] = process.argv.slice(2);
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F5F1E8"/>
  <rect x="48" y="48" width="1104" height="534" fill="none" stroke="#14120E" stroke-width="3"/>
  <rect x="48" y="48" width="1104" height="14" fill="#14120E"/>
  <text x="600" y="320" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="104" font-weight="700" fill="#14120E">${escape(name)}</text>
  <text x="600" y="400" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="40" font-style="italic" fill="#5C554A">${escape(tagline)}</text>
  <rect x="540" y="450" width="120" height="6" fill="#B3341E"/>
</svg>`;

const target = fileURLToPath(new URL("../../Blog-frontend/public/og-default.png", import.meta.url));
await writeFile(target, await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
console.log(`wrote ${target}`);
