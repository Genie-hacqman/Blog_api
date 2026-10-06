// Limits for uploaded images. Everything an upload can do is bounded here.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// largest decoded image: stops a small file that expands to gigabytes of pixels ("decompression bomb")
export const MAX_INPUT_PIXELS = 24_000_000;
export const MAX_UPLOADS_PER_DAY = 100;

// formats we accept, by the type detected from the file's bytes. SVG is deliberately absent:
// it can carry script. Everything is re-encoded to WebP, so no other format is ever stored.
export const ALLOWED_INPUT_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const OUTPUT_MIME = "image/webp";
export const OUTPUT_QUALITY = 82;

// how each purpose is resized. Avatars are cropped to a 512px square; the others fit inside
// their box and are never enlarged.
export const PURPOSES = {
    avatar: { width: 512, height: 512, fit: "cover", withoutEnlargement: false },
    cover: { width: 1600, height: 900, fit: "inside", withoutEnlargement: true },
    inline: { width: 1600, height: 4000, fit: "inside", withoutEnlargement: true },
};

// Cover and inline images that no post uses are removed by a periodic job, once they are older than this
// (so an image uploaded a minute ago, for a post still being written, is never swept).
export const ORPHAN_GRACE_HOURS = 24;
export const SWEEP_BATCH = 100;
export const SWEEP_INTERVAL_HOURS = 6;
