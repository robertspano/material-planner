import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const { productId, roomWidth, roomLength, roomHeight, surfaceType, wasteFactor = 0.10 } = await request.json();

    if (!productId || !surfaceType) {
      return NextResponse.json({ error: "productId and surfaceType are required" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.companyId !== company.id) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    let surfaceArea = 0;

    if (surfaceType === "floor") {
      if (!roomWidth || !roomLength) {
        return NextResponse.json({ error: "roomWidth and roomLength are required for floor estimates" }, { status: 400 });
      }
      surfaceArea = roomWidth * roomLength;
    } else if (surfaceType === "wall") {
      if (!roomWidth || !roomHeight) {
        return NextResponse.json({ error: "roomWidth and roomHeight are required for wall estimates" }, { status: 400 });
      }
      surfaceArea = roomWidth * roomHeight;
    }

    const totalNeeded = surfaceArea * (1 + wasteFactor);
    const totalPrice = product.price ? totalNeeded * product.price : null;

    return NextResponse.json({
      productId: product.id,
      productName: product.name,
      surfaceArea: Math.round(surfaceArea * 100) / 100,
      wasteFactor,
      totalNeeded: Math.round(totalNeeded * 100) / 100,
      pricePerUnit: product.price,
      totalPrice: totalPrice ? Math.round(totalPrice) : null,
      unit: product.unit,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
