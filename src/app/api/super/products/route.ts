import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { uploadToS3, buildS3Key } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const companyId = request.nextUrl.searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const categoryId = request.nextUrl.searchParams.get("categoryId");

    const products = await prisma.product.findMany({
      where: {
        companyId,
        ...(categoryId && { categoryId }),
      },
      include: { category: true },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(products);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const formData = await request.formData();
    const companyId = formData.get("companyId") as string;
    const name = formData.get("name") as string;
    const categoryId = formData.get("categoryId") as string;
    const description = formData.get("description") as string | null;
    const price = formData.get("price") ? parseFloat(formData.get("price") as string) : null;
    const unit = (formData.get("unit") as string) || "m2";
    const surfaceTypes = formData.get("surfaceTypes")
      ? JSON.parse(formData.get("surfaceTypes") as string)
      : ["floor"];
    const tileWidth = formData.get("tileWidth") ? parseFloat(formData.get("tileWidth") as string) : null;
    const tileHeight = formData.get("tileHeight") ? parseFloat(formData.get("tileHeight") as string) : null;
    const tileThickness = formData.get("tileThickness") ? parseFloat(formData.get("tileThickness") as string) : null;
    const discountPercent = formData.get("discountPercent") ? parseFloat(formData.get("discountPercent") as string) : null;
    const image = formData.get("image") as File | null;
    const swatch = formData.get("swatch") as File | null;

    if (!companyId || !name || !categoryId) {
      return NextResponse.json({ error: "companyId, name, and categoryId are required" }, { status: 400 });
    }

    // Upload product image
    let imageUrl = "";
    if (image) {
      const buffer = Buffer.from(await image.arrayBuffer());
      const ext = image.name.split(".").pop() || "jpg";
      const key = buildS3Key(companyId, "products", `${Date.now()}-${name.replace(/\s+/g, "-")}.${ext}`);
      imageUrl = await uploadToS3(key, buffer, image.type);
    }

    // Upload swatch image
    let swatchUrl: string | null = null;
    if (swatch) {
      const buffer = Buffer.from(await swatch.arrayBuffer());
      const ext = swatch.name.split(".").pop() || "jpg";
      const key = buildS3Key(companyId, "products", `${Date.now()}-${name.replace(/\s+/g, "-")}-swatch.${ext}`);
      swatchUrl = await uploadToS3(key, buffer, swatch.type);
    }

    const product = await prisma.product.create({
      data: {
        companyId,
        categoryId,
        name,
        description,
        price,
        unit,
        imageUrl,
        swatchUrl,
        surfaceTypes,
        tileWidth,
        tileHeight,
        tileThickness,
        discountPercent,
      },
      include: { category: true },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Create product error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
