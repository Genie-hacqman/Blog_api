import multer from "multer";
import { MAX_UPLOAD_BYTES } from "../config/media.js";

// Buffers a single uploaded file in memory (capped at MAX_UPLOAD_BYTES) for the image pipeline.
// The client's filename and Content-Type are ignored everywhere downstream.
const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4, parts: 6 },
});

export const uploadSingleImage = uploader.single("file");
