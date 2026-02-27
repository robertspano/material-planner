import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

/**
 * Combined dashboard endpoint — returns company, stats, products, and categories
 * in a SINGLE API call to avoid multiple cold starts on Vercel.
 */
export async function GET() {
  try {
    const admin = await requireAuth();
    const companyFromHeader = await getCompanyFromRequest();
    const companyId = admin.role === "super_admin" ? companyFromHeader?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // ALL queries in parallel — one cold start, one DB connection
    const [company, products, categories, totalProducts, totalGenerations, generationsThisMonth, companyLimits, generateResult] =
      await Promise.all([
        prisma.company.findUnique({
          where: { id: companyId },
          select: {
            id: true,
            name: true,
            slug: true,
            kennitala: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
          },
        }),
        prisma.product.findMany({
          where: { companyId },
          include: { category: true },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.category.findMany({
          where: { companyId },
          include: { _count: { select: { products: true } } },
          orderBy: { sortOrder: "asc" },
        }),
        prisma.product.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId } }),
        prisma.generation.count({ where: { companyId, createdAt: { gte: startOfMonth } } }),
        prisma.company.findUnique({
          where: { id: companyId },
          select: { monthlyGenerationLimit: true },
        }),
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
      company,
      products,
      categories,
      stats: {
        totalProducts,
        totalCategories: categories.length,
        totalGenerations,
        generationsThisMonth,
        generationLimit: companyLimits?.monthlyGenerationLimit || 500,
        generationsUsed: Number(generateResult[0]?.cnt || 0),
      },
    });

    res.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
