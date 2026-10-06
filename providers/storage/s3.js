import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { assertSafeKey } from "./keys.js";

// Any S3-compatible store: Cloudflare R2, AWS S3, MinIO, Backblaze B2... Switching is configuration.
// Images are served straight from the bucket's public domain (STORAGE_PUBLIC_URL), not through the API.
export const createS3Provider = (client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
})) => ({
    name: "s3",
    async put({ key, body, contentType }) {
        assertSafeKey(key);
        await client.send(
            new PutObjectCommand({
                Bucket: env.S3_BUCKET,
                Key: key,
                Body: body,
                ContentType: contentType,
                // keys are random and never reused, so the object can be cached forever
                CacheControl: "public, max-age=31536000, immutable",
            }),
        );
    },
    async delete(key) {
        assertSafeKey(key);
        await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },
    publicUrl: (key) => `${env.STORAGE_PUBLIC_URL}/${key}`,
});
