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

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // All queries in parallel — single DB round trip via connection pool
    const [totalProducts, totalCategories, totalGenerations, generationsThisMonth, companyData, generateResult] =
      await Promise.all([
        prisma.product.count({ where: { companyId } }),
        prisma.category.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId, createdAt: { gte: startOfMonth } } }),
        prisma.company.findUnique({
          where: { id: companyId },
          select: { monthlyGenerationLimit: true },
        }),
        // Count distinct generates — same logic as super admin
        prisma.$queryRaw<{ cnt: bigint }[]>`
          SELECT COUNT(*) as cnt FROM (
            SELECT DISTINCT "batchId" AS grp FROM "Generation"
            WHERE "batchId" IS NOT NULL AND "companyId" = ${companyId}
            UNION ALL
            SELECT DISTINCT "sessionId" AS grp FROM "Generation"
            WHERE "batchId" IS NULL AND "companyId" = ${companyId}
          ) sub
        `,
      ]);

    const res = NextResponse.json({
      totalProducts,
      totalCategories,
      totalGenerations,
      generationsThisMonth,
      generationLimit: companyData?.monthlyGenerationLimit || 500,
      generationsUsed: Number(generateResult[0]?.cnt || 0),
    });

    res.headers.set("Cache-Control", "private, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
