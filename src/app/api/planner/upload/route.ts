import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromRequest } from "@/lib/tenant";
import { uploadToS3, buildS3Key } from "@/lib/s3";

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const image = formData.get("image") as File | null;
    const sessionId = (formData.get("sessionId") as string) || crypto.randomUUID();

    if (!image) {
      return NextResponse.json({ error: "Image is required" }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowedTypes.includes(image.type)) {
      return NextResponse.json({ error: "Invalid image type. Allowed: JPEG, PNG, WebP, HEIC" }, { status: 400 });
    }

    // Validate file size (max 20MB)
    if (image.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Image too large. Maximum size is 20MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const ext = image.name.split(".").pop() || "jpg";
    const timestamp = Date.now();
    let roomImageUrl: string;

    // Use Cloudinary CDN if configured, otherwise S3
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const { uploadToCloudinary } = await import("@/lib/cloudinary");
      const filename = `${company.slug}-${timestamp}-${sessionId.slice(0, 8)}.${ext}`;
      roomImageUrl = await uploadToCloudinary(buffer, filename);
    } else {
      const key = buildS3Key(company.id, "rooms", `${timestamp}-${sessionId.slice(0, 8)}.${ext}`);
      roomImageUrl = await uploadToS3(key, buffer, image.type);
    }

    // Create generation record
    const generation = await prisma.generation.create({
      data: {
        companyId: company.id,
        sessionId,
        roomImageUrl,
        status: "pending",
      },
    });

    return NextResponse.json({
      id: generation.id,
      sessionId,
      imageUrl: generation.roomImageUrl,
      roomImageUrl: generation.roomImageUrl,
      status: generation.status,
    }, { status: 201 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
