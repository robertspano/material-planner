import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const companyId = request.nextUrl.searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 });
    }

    const categories = await prisma.category.findMany({
      where: { companyId },
      include: { _count: { select: { products: true } } },
      orderBy: { sortOrder: "asc" },
    });

    return NextResponse.json(categories);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const { companyId, name, surfaceType, sortOrder } = await request.json();

    if (!companyId || !name || !surfaceType) {
      return NextResponse.json({ error: "companyId, name, and surfaceType are required" }, { status: 400 });
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
      include: { _count: { select: { products: true } } },
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Create category error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
