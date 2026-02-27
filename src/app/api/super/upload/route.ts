import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const folder = (formData.get("folder") as string) || "company-logos";

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" }, { status: 400 });
    }

    // Validate file size (max 5MB for logos)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const ext = file.name.split(".").pop() || "png";
    const publicId = `${folder}/${timestamp}-${file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_")}`;

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "image",
          transformation: [
            { width: 400, height: 400, crop: "limit" },
            { quality: "auto:best" },
            { fetch_format: "auto" },
          ],
        },
        (error, result) => {
          if (error || !result) {
            reject(error || new Error("Upload failed"));
            return;
          }
          resolve(result as { secure_url: string });
        }
      );
      uploadStream.end(buffer);
    });

    return NextResponse.json({ url: result.secure_url });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
