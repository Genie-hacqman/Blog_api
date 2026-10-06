import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { ALLOWED_INPUT_MIME, MAX_INPUT_PIXELS, OUTPUT_MIME, OUTPUT_QUALITY, PURPOSES } from "../config/media.js";
import { AppError } from "./AppError.js";

// Turn an untrusted upload into a safe, small WebP.
//
// 1. The type comes from the file's own bytes, never from its name or Content-Type header.
// 2. The image is fully decoded and re-encoded. Anything that is not really an image fails
//    here, and anything hidden inside one (scripts, polyglot payloads, metadata) is not copied
//    to the output, because only pixels survive a re-encode.
// 3. EXIF rotation is applied and all metadata, including GPS and camera data, is dropped.
export const processImage = async (buffer, purpose) => {
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !ALLOWED_INPUT_MIME.includes(detected.mime)) {
        throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG, WebP and GIF images are allowed");
    }

    const { width, height, fit, withoutEnlargement } = PURPOSES[purpose];
    try {
        const { data, info } = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
            .rotate()
            .resize({ width, height, fit, withoutEnlargement })
            .webp({ quality: OUTPUT_QUALITY })
            .toBuffer({ resolveWithObject: true });

        return { body: data, width: info.width, height: info.height, size: info.size, mime: OUTPUT_MIME };
    } catch {
        // corrupt data, or larger than MAX_INPUT_PIXELS
        throw new AppError(400, "INVALID_IMAGE", "That file could not be read as an image, or it is too large");
    }
};
