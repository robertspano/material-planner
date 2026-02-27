import { NextResponse } from "next/server";
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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const companyData = await prisma.company.findUnique({ where: { id: companyId } });

    const [totalProducts, totalCategories, totalGenerations, generationsThisMonth] =
      await Promise.all([
        prisma.product.count({ where: { companyId, isActive: true } }),
        prisma.category.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId, createdAt: { gte: startOfMonth } } }),
      ]);

    return NextResponse.json({
      totalProducts,
      totalCategories,
      totalGenerations,
      generationsThisMonth,
      generationLimit: companyData?.monthlyGenerationLimit || 500,
      generationsUsed: companyData?.generationsUsed || 0,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
