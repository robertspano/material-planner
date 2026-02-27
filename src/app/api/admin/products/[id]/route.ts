import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { uploadToS3, buildS3Key } from "@/lib/s3";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const updateData: Record<string, unknown> = {};

      const name = formData.get("name") as string | null;
      if (name) updateData.name = name;

      const description = formData.get("description") as string | null;
      if (description !== null) updateData.description = description;

      const price = formData.get("price") as string | null;
      if (price) updateData.price = parseFloat(price);

      const unit = formData.get("unit") as string | null;
      if (unit) updateData.unit = unit;

      const categoryId = formData.get("categoryId") as string | null;
      if (categoryId) updateData.categoryId = categoryId;

      const surfaceTypes = formData.get("surfaceTypes") as string | null;
      if (surfaceTypes) updateData.surfaceTypes = JSON.parse(surfaceTypes);

      const isActive = formData.get("isActive") as string | null;
      if (isActive !== null) updateData.isActive = isActive === "true";

      const discountPercent = formData.get("discountPercent") as string | null;
      if (formData.has("discountPercent")) {
        updateData.discountPercent = discountPercent ? parseFloat(discountPercent) : null;
      }

      // Handle image upload
      const image = formData.get("image") as File | null;
      if (image) {
        const existing = await prisma.product.findUnique({ where: { id } });
        if (existing) {
          const buffer = Buffer.from(await image.arrayBuffer());
          const ext = image.name.split(".").pop() || "jpg";
          const key = buildS3Key(existing.companyId, "products", `${Date.now()}.${ext}`);
          updateData.imageUrl = await uploadToS3(key, buffer, image.type);
        }
      }

      const swatch = formData.get("swatch") as File | null;
      if (swatch) {
        const existing = await prisma.product.findUnique({ where: { id } });
        if (existing) {
          const buffer = Buffer.from(await swatch.arrayBuffer());
          const ext = swatch.name.split(".").pop() || "jpg";
          const key = buildS3Key(existing.companyId, "products", `${Date.now()}-swatch.${ext}`);
          updateData.swatchUrl = await uploadToS3(key, buffer, swatch.type);
        }
      }

      const product = await prisma.product.update({
        where: { id },
        data: updateData,
        include: { category: true },
      });

      return NextResponse.json(product);
    }

    // JSON body
    const data = await request.json();
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
        ...(data.surfaceTypes !== undefined && { surfaceTypes: data.surfaceTypes }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
        ...(data.discountPercent !== undefined && { discountPercent: data.discountPercent }),
      },
      include: { category: true },
    });

    return NextResponse.json(product);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;

    // Hard delete: remove related records first, then the product
    await prisma.$transaction([
      prisma.generationProduct.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Delete product error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
