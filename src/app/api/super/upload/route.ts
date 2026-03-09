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
    const uploadType = (formData.get("type") as string) || "logo";

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, SVG" }, { status: 400 });
    }

    // Validate file size — backgrounds allow 10MB, logos 5MB
    const maxSize = uploadType === "background" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json({ error: `File too large. Maximum size is ${maxSize / (1024 * 1024)}MB` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const ext = file.name.split(".").pop() || "png";
    const publicId = `${folder}/${timestamp}-${file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_")}`;

    // Different transformations for logos vs backgrounds
    const transformation = uploadType === "background"
      ? [{ width: 1920, height: 1080, crop: "limit" as const }, { quality: "auto:good" as const }, { fetch_format: "auto" as const }]
      : [{ width: 400, height: 400, crop: "limit" as const }, { quality: "auto:best" as const }, { fetch_format: "auto" as const }];

    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          resource_type: "image",
          transformation,
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
