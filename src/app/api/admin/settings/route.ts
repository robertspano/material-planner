import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAuth();
    const company = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? company?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const primaryColor = formData.get("primaryColor") as string | null;
    const secondaryColor = formData.get("secondaryColor") as string | null;
    const logoFile = formData.get("logo") as File | null;

    const updateData: Record<string, unknown> = {};

    if (primaryColor) updateData.primaryColor = primaryColor;
    if (secondaryColor) updateData.secondaryColor = secondaryColor;

    // Handle logo upload
    if (logoFile) {
      const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
      if (!allowedTypes.includes(logoFile.type)) {
        return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
      }
      if (logoFile.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 400 });
      }

      const buffer = Buffer.from(await logoFile.arrayBuffer());
      const timestamp = Date.now();
      const publicId = `company-logos/${companyId}-${timestamp}`;

      const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "company-logos",
            public_id: publicId,
            resource_type: "image",
            transformation: [
              { width: 400, height: 200, crop: "limit" },
              { quality: "auto:best" },
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

      updateData.logoUrl = result.secure_url;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No changes" }, { status: 400 });
    }

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    // Invalidate company branding cache
    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logoUrl: updated.logoUrl,
      primaryColor: updated.primaryColor,
      secondaryColor: updated.secondaryColor,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Settings update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
