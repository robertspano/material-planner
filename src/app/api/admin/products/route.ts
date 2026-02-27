import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";
import { uploadToS3, buildS3Key } from "@/lib/s3";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth();
    const company = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? company?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
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

    const res = NextResponse.json(products);
    res.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAuth();
    const company = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? company?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const categoryId = formData.get("categoryId") as string;
    const description = formData.get("description") as string | null;
    const price = formData.get("price") ? parseFloat(formData.get("price") as string) : null;
    const unit = (formData.get("unit") as string) || "m2";
    const surfaceTypes = formData.get("surfaceTypes")
      ? JSON.parse(formData.get("surfaceTypes") as string)
      : ["floor"];
    const discountPercent = formData.get("discountPercent") ? parseFloat(formData.get("discountPercent") as string) : null;
    const image = formData.get("image") as File | null;
    const swatch = formData.get("swatch") as File | null;

    if (!name || !categoryId) {
      return NextResponse.json({ error: "Name and categoryId are required" }, { status: 400 });
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
        discountPercent,
      },
      include: { category: true },
    });

    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
