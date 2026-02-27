import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

type Range = "day" | "week" | "month" | "6months" | "year" | "all";

interface RawRow {
  bucket: Date;
  count: bigint;
  companyId: string;
}

function getRangeConfig(range: Range): { since: Date; trunc: "hour" | "day" | "week" | "month" } {
  const now = new Date();
  switch (range) {
    case "day":
      return { since: new Date(now.getTime() - 24 * 60 * 60 * 1000), trunc: "hour" };
    case "week":
      return { since: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), trunc: "day" };
    case "month":
      return { since: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30), trunc: "day" };
    case "6months":
      return { since: new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()), trunc: "week" };
    case "year":
      return { since: new Date(now.getFullYear() - 1, now.getMonth(), 1), trunc: "month" };
    case "all":
      return { since: new Date(2020, 0, 1), trunc: "month" };
    default:
      return { since: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30), trunc: "day" };
  }
}

// Build bucketed image query (COUNT of Generation rows)
function imageQuery(trunc: string, since: Date) {
  if (trunc === "hour") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT DATE_TRUNC('hour', "createdAt") as bucket, COUNT(*) as count, "companyId"
      FROM "Generation"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE_TRUNC('hour', "createdAt"), "companyId"
      ORDER BY bucket ASC
    `;
  } else if (trunc === "day") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT DATE_TRUNC('day', "createdAt") as bucket, COUNT(*) as count, "companyId"
      FROM "Generation"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE_TRUNC('day', "createdAt"), "companyId"
      ORDER BY bucket ASC
    `;
  } else if (trunc === "week") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT DATE_TRUNC('week', "createdAt") as bucket, COUNT(*) as count, "companyId"
      FROM "Generation"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE_TRUNC('week', "createdAt"), "companyId"
      ORDER BY bucket ASC
    `;
  } else {
    return prisma.$queryRaw<RawRow[]>`
      SELECT DATE_TRUNC('month', "createdAt") as bucket, COUNT(*) as count, "companyId"
      FROM "Generation"
      WHERE "createdAt" >= ${since}
      GROUP BY DATE_TRUNC('month', "createdAt"), "companyId"
      ORDER BY bucket ASC
    `;
  }
}

// Build bucketed generate query (COUNT DISTINCT batchId = one "button press")
// Old records without batchId: group by sessionId as fallback
function generateQuery(trunc: string, since: Date) {
  if (trunc === "hour") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT bucket, "companyId", COUNT(*) as count FROM (
        SELECT DATE_TRUNC('hour', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY "batchId", "companyId"
        UNION ALL
        SELECT DATE_TRUNC('hour', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NULL AND "createdAt" >= ${since}
        GROUP BY "sessionId", "companyId"
      ) sub
      GROUP BY bucket, "companyId"
      ORDER BY bucket ASC
    `;
  } else if (trunc === "day") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT bucket, "companyId", COUNT(*) as count FROM (
        SELECT DATE_TRUNC('day', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY "batchId", "companyId"
        UNION ALL
        SELECT DATE_TRUNC('day', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NULL AND "createdAt" >= ${since}
        GROUP BY "sessionId", "companyId"
      ) sub
      GROUP BY bucket, "companyId"
      ORDER BY bucket ASC
    `;
  } else if (trunc === "week") {
    return prisma.$queryRaw<RawRow[]>`
      SELECT bucket, "companyId", COUNT(*) as count FROM (
        SELECT DATE_TRUNC('week', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY "batchId", "companyId"
        UNION ALL
        SELECT DATE_TRUNC('week', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NULL AND "createdAt" >= ${since}
        GROUP BY "sessionId", "companyId"
      ) sub
      GROUP BY bucket, "companyId"
      ORDER BY bucket ASC
    `;
  } else {
    return prisma.$queryRaw<RawRow[]>`
      SELECT bucket, "companyId", COUNT(*) as count FROM (
        SELECT DATE_TRUNC('month', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NOT NULL AND "createdAt" >= ${since}
        GROUP BY "batchId", "companyId"
        UNION ALL
        SELECT DATE_TRUNC('month', MIN("createdAt")) as bucket, "companyId"
        FROM "Generation"
        WHERE "batchId" IS NULL AND "createdAt" >= ${since}
        GROUP BY "sessionId", "companyId"
      ) sub
      GROUP BY bucket, "companyId"
      ORDER BY bucket ASC
    `;
  }
}

function buildPoints(rows: RawRow[], priceMap?: Map<string, number>) {
  const pointsMap = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = row.bucket.toISOString();
    if (!pointsMap.has(key)) pointsMap.set(key, {});
    const entry = pointsMap.get(key)!;
    const count = Number(row.count);
    entry[row.companyId] = (entry[row.companyId] || 0) + count;
  }
  return [...pointsMap.entries()].sort().map(([date, companyCounts]) => {
    let total = 0;
    let revenue = 0;
    for (const [companyId, count] of Object.entries(companyCounts)) {
      total += count;
      if (priceMap) revenue += count * (priceMap.get(companyId) || 0);
    }
    return { date, total, revenue, ...companyCounts };
  });
}

function sumPeriodByCompany(rows: RawRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.companyId, (map.get(row.companyId) || 0) + Number(row.count));
  }
  return map;
}

// All-time generate counts per company
async function allTimeGeneratesByCompany() {
  const result = await prisma.$queryRaw<{ companyId: string; count: bigint }[]>`
    SELECT "companyId", COUNT(*) as count FROM (
      SELECT DISTINCT "companyId", "batchId" AS grp FROM "Generation" WHERE "batchId" IS NOT NULL
      UNION ALL
      SELECT DISTINCT "companyId", "sessionId" AS grp FROM "Generation" WHERE "batchId" IS NULL
    ) sub
    GROUP BY "companyId"
  `;
  return new Map(result.map(r => [r.companyId, Number(r.count)]));
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const range = (request.nextUrl.searchParams.get("range") || "month") as Range;
    const validRanges: Range[] = ["day", "week", "month", "6months", "year", "all"];
    const safeRange = validRanges.includes(range) ? range : "month";
    const { since, trunc } = getRangeConfig(safeRange);

    // Fetch companies
    const companies = await prisma.company.findMany({
      select: {
        id: true,
        name: true,
        primaryColor: true,
        pricePerGeneration: true,
        _count: { select: { generations: true } }, // total images (Generation rows)
      },
      orderBy: { generations: { _count: "desc" } },
    });

    const priceMap = new Map(companies.map(c => [c.id, c.pricePerGeneration]));

    // Run all queries in parallel
    const [imgRows, genRows, allTimeGensMap] = await Promise.all([
      imageQuery(trunc, since),
      generateQuery(trunc, since),
      allTimeGeneratesByCompany(),
    ]);

    // Build point arrays
    const imagePoints = buildPoints(imgRows);
    const generatePoints = buildPoints(genRows, priceMap); // revenue on generates

    // Period totals
    const imgPeriodByCompany = sumPeriodByCompany(imgRows);
    const genPeriodByCompany = sumPeriodByCompany(genRows);

    const periodImages = imagePoints.reduce((s, p) => s + p.total, 0);
    const periodGenerates = generatePoints.reduce((s, p) => s + p.total, 0);
    const periodRevenue = generatePoints.reduce((s, p) => s + p.revenue, 0);

    // All-time totals
    const allTimeImages = companies.reduce((s, c) => s + c._count.generations, 0);
    const allTimeGenerates = [...allTimeGensMap.values()].reduce((s, v) => s + v, 0);
    const allTimeRevenue = companies.reduce((s, c) => {
      const gens = allTimeGensMap.get(c.id) || 0;
      return s + gens * c.pricePerGeneration;
    }, 0);

    return NextResponse.json({
      companies: companies.map(c => ({
        id: c.id,
        name: c.name,
        primaryColor: c.primaryColor,
        pricePerGeneration: c.pricePerGeneration,
        totalImages: c._count.generations,
        totalGenerates: allTimeGensMap.get(c.id) || 0,
        totalRevenue: (allTimeGensMap.get(c.id) || 0) * c.pricePerGeneration,
        periodImages: imgPeriodByCompany.get(c.id) || 0,
        periodGenerates: genPeriodByCompany.get(c.id) || 0,
        periodRevenue: (genPeriodByCompany.get(c.id) || 0) * c.pricePerGeneration,
      })),
      imagePoints,
      generatePoints,
      summary: {
        totalImages: allTimeImages,
        totalGenerates: allTimeGenerates,
        totalRevenue: allTimeRevenue,
        periodImages,
        periodGenerates,
        periodRevenue,
      },
      range: safeRange,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Finance API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
