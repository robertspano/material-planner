import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const generation = await prisma.generation.findUnique({
      where: { id },
      include: {
        products: { include: { product: true } },
        results: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!generation) {
      return NextResponse.json({ error: "Generation not found" }, { status: 404 });
    }

    return NextResponse.json(generation);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
