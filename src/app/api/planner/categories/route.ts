import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const categories = await prisma.category.findMany({
      where: { companyId: company.id },
      include: { _count: { select: { products: { where: { isActive: true } } } } },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(categories, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
