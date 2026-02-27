import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const categoryId = request.nextUrl.searchParams.get("categoryId");
    const surfaceType = request.nextUrl.searchParams.get("surfaceType");

    const products = await prisma.product.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        ...(categoryId && { categoryId }),
        ...(surfaceType && { surfaceTypes: { has: surfaceType } }),
      },
      include: { category: true },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(products, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
