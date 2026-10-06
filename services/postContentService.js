import { MAX_IMAGES_PER_POST, MAX_TEXT_LENGTH } from "../config/posts.js";
import { findOwnedMediaByIds, findOwnedMediaByKeys } from "../repositories/mediaRepository.js";
import { getStorage } from "../providers/storage/index.js";
import { extractImageSrcs, htmlToText, removeImages, sanitizeContent } from "../utils/richText.js";
import { AppError, ValidationError } from "../utils/AppError.js";

// our own upload keys look like u/<ownerId>/<uuid>.webp (see mediaService.storeImage)
const OWN_KEY = /^u\/\d+\/[0-9a-f-]{36}\.webp$/;

// the storage key an image URL points at, or null when the URL is not one of our uploads
const keyFromUrl = (src) => {
    const prefix = getStorage().publicUrl("");
    if (!src.startsWith(prefix)) return null;
    const key = src.slice(prefix.length);
    return OWN_KEY.test(key) ? key : null;
};

const invalidImage = () =>
    new AppError(400, "INVALID_IMAGE", "Images must be uploaded through the editor; an image from another site, or someone else's upload, cannot be used");

// What gets stored for a post body. Everything the author sends is sanitized; the readable text is
// derived from the result; and every image must be one of the author's own live inline uploads.
// Returns { content (safe HTML), contentText, mediaIds (the inline images in use) }.
// `strictImages: false` (a restored revision) drops images that are no longer available instead of refusing.
export const prepareContent = async (user, html, { strictImages = true } = {}) => {
    let content = sanitizeContent(html);

    const contentText = htmlToText(content);
    if (!contentText) throw new ValidationError("content is required");
    if (contentText.length > MAX_TEXT_LENGTH) {
        throw new ValidationError(`content must be at most ${MAX_TEXT_LENGTH} characters of text`);
    }

    const sources = extractImageSrcs(content);
    if (sources.length > MAX_IMAGES_PER_POST) {
        throw new ValidationError(`a post can have at most ${MAX_IMAGES_PER_POST} images`);
    }

    const keyOf = new Map(sources.map((src) => [src, keyFromUrl(src)]));
    const found = await findOwnedMediaByKeys([...new Set([...keyOf.values()].filter(Boolean))], user.id, "inline");
    const idByKey = new Map(found.map((media) => [media.key, media.id]));

    const unknown = new Set(sources.filter((src) => !idByKey.has(keyOf.get(src))));
    if (unknown.size > 0) {
        if (strictImages) throw invalidImage();
        content = removeImages(content, (src) => unknown.has(src));
    }

    const mediaIds = [...new Set(sources.filter((src) => !unknown.has(src)).map((src) => idByKey.get(keyOf.get(src))))];
    return { content, contentText, mediaIds };
};

// a cover image must be one of the author's own live cover uploads; null means "no cover"
export const resolveCover = async (user, coverMediaId) => {
    if (coverMediaId === null || coverMediaId === undefined) return null;
    const [media] = await findOwnedMediaByIds([coverMediaId], user.id, "cover");
    if (!media) throw new ValidationError("That cover image does not exist");
    return media.id;
};
