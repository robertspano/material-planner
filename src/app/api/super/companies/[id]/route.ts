import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const data = await request.json();

    const company = await prisma.company.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.kennitala !== undefined && { kennitala: data.kennitala }),
        ...(data.primaryColor !== undefined && { primaryColor: data.primaryColor }),
        ...(data.secondaryColor !== undefined && { secondaryColor: data.secondaryColor }),
        ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
        ...(data.logoIsLight !== undefined && { logoIsLight: data.logoIsLight }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.monthlyGenerationLimit !== undefined && { monthlyGenerationLimit: data.monthlyGenerationLimit }),
        ...(data.plan !== undefined && { plan: data.plan }),
      },
    });

    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin();
    const { id } = await params;

    // Permanently delete company and all related data
    await prisma.$transaction(async (tx) => {
      // Delete generation results first (depends on generations)
      await tx.generationResult.deleteMany({
        where: { generation: { companyId: id } },
      });
      // Delete generation products (depends on generations and products)
      await tx.generationProduct.deleteMany({
        where: { generation: { companyId: id } },
      });
      // Delete generations
      await tx.generation.deleteMany({ where: { companyId: id } });
      // Delete products
      await tx.product.deleteMany({ where: { companyId: id } });
      // Delete categories
      await tx.category.deleteMany({ where: { companyId: id } });
      // Delete admins
      await tx.companyAdmin.deleteMany({ where: { companyId: id } });
      // Delete company
      await tx.company.delete({ where: { id } });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Delete company error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
