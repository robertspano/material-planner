import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    const admin = await requireAuth();
    const companyFromHeader = await getCompanyFromRequest();
    const companyId =
      admin.role === "super_admin" ? companyFromHeader?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 },
      );
    }

    const generations = await prisma.generation.findMany({
      where: { companyId, status: "completed" },
      include: {
        products: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                unit: true,
                imageUrl: true,
                discountPercent: true,
                tileWidth: true,
                tileHeight: true,
              },
            },
          },
        },
        results: {
          select: { imageUrl: true, surfaceType: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const res = NextResponse.json(generations);
    res.headers.set(
      "Cache-Control",
      "private, max-age=30, stale-while-revalidate=60",
    );
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Quotes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
