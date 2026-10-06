import { randomUUID } from "node:crypto";
import { MAX_UPLOADS_PER_DAY } from "../config/media.js";
import {
    countUploadsSince,
    createMedia,
    destroyMedia,
    findOwnedMedia,
    isMediaReferenced,
    softDeleteMedia,
} from "../repositories/mediaRepository.js";
import { getStorage } from "../providers/storage/index.js";
import { processImage } from "../utils/image.js";
import { AppError, NotFoundError, TooManyRequestsError } from "../utils/AppError.js";
import logger from "../config/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const toMediaDto = (media) => ({
    id: media.id,
    url: getStorage().publicUrl(media.key),
    width: media.width,
    height: media.height,
    purpose: media.purpose,
    size: media.size,
});

// Store an uploaded image for `ownerId`. The object key is generated here (never derived from
// the upload), the row is written first so quota counting sees it, and it is removed again if the
// file cannot be stored.
export const storeImage = async (ownerId, file, purpose) => {
    if (!file) {
        throw new AppError(400, "NO_FILE", 'Attach an image in the "file" field');
    }
    if ((await countUploadsSince(ownerId, new Date(Date.now() - DAY_MS))) >= MAX_UPLOADS_PER_DAY) {
        throw new TooManyRequestsError("Daily upload limit reached. Try again tomorrow.");
    }

    const image = await processImage(file.buffer, purpose);
    const key = `u/${ownerId}/${randomUUID()}.webp`;

    const media = await createMedia({ ownerId, key, mime: image.mime, size: image.size, width: image.width, height: image.height, purpose });
    try {
        await getStorage().put({ key, body: image.body, contentType: image.mime });
    } catch (error) {
        await destroyMedia(media.id);
        throw error;
    }
    return media;
};

// Retire an image: mark the row deleted, then try to remove the file. A failed file removal is
// logged, not thrown, because the user-facing action has already succeeded.
export const discardMedia = async (media) => {
    await softDeleteMedia(media.id);
    try {
        await getStorage().delete(media.key);
    } catch (error) {
        logger.error({ err: error, mediaId: media.id }, "Failed to delete stored file");
    }
};

export const uploadPostImage = async (user, file, purpose) => toMediaDto(await storeImage(user.id, file, purpose));

// Owners delete their own cover/inline images. Anything else (someone else's, already deleted,
// or a profile photo, which has its own endpoint) is simply "not found".
export const deleteOwnedMedia = async (user, id) => {
    const media = await findOwnedMedia(id, user.id);
    if (!media || media.purpose === "avatar") {
        throw new NotFoundError("Media not found");
    }
    // an image a post still shows must not disappear from under it
    if (await isMediaReferenced(media.id)) {
        throw new AppError(409, "MEDIA_IN_USE", "This image is used by a post. Remove it from the post first.");
    }
    await discardMedia(media);
};
