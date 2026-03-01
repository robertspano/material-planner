import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload an image to Cloudinary and return the direct URL.
 * No transformations — just a reliable, fast CDN URL.
 */
export async function uploadToCloudinary(
  buffer: Buffer,
  filename: string,
  folder = "planner-rooms"
): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename.replace(/\.[^.]+$/, ""),
        resource_type: "image",
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Cloudinary upload failed"));
          return;
        }
        console.log(`[Cloudinary] Uploaded: ${result.secure_url} (${result.width}x${result.height})`);
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}
