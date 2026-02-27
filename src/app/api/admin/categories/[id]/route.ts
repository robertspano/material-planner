import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;
    const data = await request.json();

    const category = await prisma.category.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.surfaceType !== undefined && { surfaceType: data.surfaceType }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });

    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth();
    const { id } = await params;

    // Check for products in this category
    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${productCount} products. Move or delete products first.` },
        { status: 400 }
      );
    }

    await prisma.category.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
