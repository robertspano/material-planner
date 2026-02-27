import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth();
    const company = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? company?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "20");
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");

    const [generations, total] = await Promise.all([
      prisma.generation.findMany({
        where: { companyId },
        include: {
          products: { include: { product: true } },
          results: true,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.generation.count({ where: { companyId } }),
    ]);

    return NextResponse.json({ generations, total });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
