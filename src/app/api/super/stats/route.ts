import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireSuperAdmin();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalCompanies, activeCompanies, totalProducts, totalGenerations, generationsThisMonth, companiesWithCounts] =
      await Promise.all([
        prisma.company.count(),
        prisma.company.count({ where: { isActive: true } }),
        prisma.product.count(),
        prisma.generation.count(),
        prisma.generation.count({ where: { createdAt: { gte: startOfMonth } } }),
        prisma.company.findMany({
          select: { id: true, name: true, _count: { select: { generations: true } } },
          orderBy: { generations: { _count: "desc" } },
        }),
      ]);

    // Count distinct "generates" (button presses):
    // - New records: each unique batchId = one generate
    // - Old records (no batchId): group by sessionId — all images from same session = one generate
    const batchByCompanyResult = await prisma.$queryRaw<{ companyId: string; generateCount: bigint }[]>`
      SELECT "companyId", COUNT(*) as "generateCount" FROM (
        SELECT DISTINCT "companyId", "batchId" AS grp FROM "Generation" WHERE "batchId" IS NOT NULL
        UNION ALL
        SELECT DISTINCT "companyId", "sessionId" AS grp FROM "Generation" WHERE "batchId" IS NULL
      ) sub
      GROUP BY "companyId"
    `;
    const generatesByCompanyMap = new Map<string, number>();
    let totalGenerates = 0;
    for (const row of batchByCompanyResult) {
      const count = Number(row.generateCount);
      generatesByCompanyMap.set(row.companyId, count);
      totalGenerates += count;
    }

    const generationsByCompany = companiesWithCounts.map(c => ({
      companyName: c.name,
      imageCount: c._count.generations,
      generateCount: generatesByCompanyMap.get(c.id) || 0,
    }));

    const res = NextResponse.json({
      totalCompanies,
      activeCompanies,
      totalProducts,
      totalGenerations,
      generationsThisMonth,
      totalGenerates,
      generationsByCompany,
    });
    res.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
