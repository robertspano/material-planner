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

    // Single query: all counts + generates in one DB round trip
    const [countsResult, companyData] = await Promise.all([
      prisma.$queryRaw<{
        totalProducts: bigint;
        totalCategories: bigint;
        totalGenerations: bigint;
        generationsThisMonth: bigint;
        generatesCount: bigint;
      }[]>`
        SELECT
          (SELECT COUNT(*) FROM "Product" WHERE "companyId" = ${companyId}) as "totalProducts",
          (SELECT COUNT(*) FROM "Category" WHERE "companyId" = ${companyId}) as "totalCategories",
          (SELECT COUNT(*) FROM "Generation" WHERE "companyId" = ${companyId}) as "totalGenerations",
          (SELECT COUNT(*) FROM "Generation" WHERE "companyId" = ${companyId} AND "createdAt" >= ${startOfMonth}) as "generationsThisMonth",
          (SELECT COUNT(*) FROM (
            SELECT DISTINCT "batchId" AS grp FROM "Generation" WHERE "batchId" IS NOT NULL AND "companyId" = ${companyId}
            UNION ALL
            SELECT DISTINCT "sessionId" AS grp FROM "Generation" WHERE "batchId" IS NULL AND "companyId" = ${companyId}
          ) sub) as "generatesCount"
      `,
      prisma.company.findUnique({
        where: { id: companyId },
        select: { monthlyGenerationLimit: true },
      }),
    ]);

    const c = countsResult[0];

    const res = NextResponse.json({
      totalProducts: Number(c?.totalProducts || 0),
      totalCategories: Number(c?.totalCategories || 0),
      totalGenerations: Number(c?.totalGenerations || 0),
      generationsThisMonth: Number(c?.generationsThisMonth || 0),
      generationLimit: companyData?.monthlyGenerationLimit || 500,
      generationsUsed: Number(c?.generatesCount || 0),
    });

    // Cache for 30s, serve stale for 60s while revalidating
    res.headers.set("Cache-Control", "private, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
