import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-west-1",
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
      }
    : undefined,
});

const BUCKET = process.env.S3_BUCKET || "planner-assets";
const CDN_URL = process.env.CDN_URL || "";

/**
 * Upload a file to S3.
 * Returns the public URL (via CDN if configured, otherwise S3).
 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  // In development without S3, save locally
  if (!process.env.AWS_ACCESS_KEY_ID) {
    return saveLocally(key, body);
  }

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    })
  );

  if (CDN_URL) {
    return `${CDN_URL}/${key}`;
  }
  return `https://${BUCKET}.s3.${process.env.AWS_REGION || "eu-west-1"}.amazonaws.com/${key}`;
}

/**
 * Generate a presigned URL for direct upload from the browser.
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from S3.
 */
export async function deleteFromS3(key: string): Promise<void> {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    // Local dev - just skip
    return;
  }

  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

/**
 * Build S3 key paths for different asset types.
 */
export function buildS3Key(companyId: string, type: "products" | "rooms" | "results" | "logos", filename: string): string {
  return `${companyId}/${type}/${filename}`;
}

/**
 * Local file storage fallback for development.
 */
async function saveLocally(key: string, body: Buffer | Uint8Array): Promise<string> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const dir = path.join(process.cwd(), "public", "uploads", path.dirname(key));
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(process.cwd(), "public", "uploads", key);
  await fs.writeFile(filePath, body);

  return `/uploads/${key}`;
}
