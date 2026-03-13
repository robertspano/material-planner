import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload an image to Cloudinary and return the direct URL.
 * Uses eager transformations for fast CDN delivery.
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
        // Optimize delivery: auto quality + auto format for fast loading
        quality: "auto:good",
        fetch_format: "auto",
        // Overwrite existing to avoid duplicates
        overwrite: true,
        // Skip Cloudinary's own resizing (we already did it with sharp)
        transformation: [],
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Cloudinary upload failed"));
          return;
        }
        console.log(`[Cloudinary] Uploaded: ${result.secure_url} (${result.width}x${result.height}, ${Math.round(result.bytes / 1024)}KB)`);
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}
