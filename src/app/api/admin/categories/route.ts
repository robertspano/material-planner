import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    const admin = await requireAuth();
    const company = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? company?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const categories = await prisma.category.findMany({
      where: { companyId },
      include: { _count: { select: { products: true } } },
      orderBy: { sortOrder: "asc" },
    });

    const res = NextResponse.json(categories);
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

    const { name, surfaceType, sortOrder } = await request.json();

    if (!name || !surfaceType) {
      return NextResponse.json({ error: "Name and surfaceType are required" }, { status: 400 });
    }

    if (!["floor", "wall", "both"].includes(surfaceType)) {
      return NextResponse.json({ error: "surfaceType must be 'floor', 'wall', or 'both'" }, { status: 400 });
    }

    const category = await prisma.category.create({
      data: {
        companyId,
        name,
        surfaceType,
        sortOrder: sortOrder || 0,
      },
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
