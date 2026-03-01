import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";

interface BucketRow {
  bucket: Date;
  count: bigint;
}

export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const companyId = request.nextUrl.searchParams.get("companyId");
    const sinceStr = request.nextUrl.searchParams.get("since");
    const untilStr = request.nextUrl.searchParams.get("until");

    if (!companyId || !sinceStr || !untilStr) {
      return NextResponse.json({ error: "Missing companyId, since, or until" }, { status: 400 });
    }

    const since = new Date(sinceStr + "T00:00:00.000Z");
    const untilEnd = new Date(untilStr + "T00:00:00.000Z");
    untilEnd.setUTCDate(untilEnd.getUTCDate() + 1); // inclusive end-of-day

    // Two parallel queries: images (COUNT rows) and generates (COUNT DISTINCT batchId/sessionId)
    const [imgRows, genRows] = await Promise.all([
      prisma.$queryRaw<BucketRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") as bucket, COUNT(*) as count
        FROM "Generation"
        WHERE "companyId" = ${companyId}
          AND "createdAt" >= ${since}
          AND "createdAt" < ${untilEnd}
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      prisma.$queryRaw<BucketRow[]>`
        SELECT bucket, COUNT(*) as count FROM (
          SELECT DATE_TRUNC('day', MIN("createdAt")) as bucket
          FROM "Generation"
          WHERE "batchId" IS NOT NULL
            AND "companyId" = ${companyId}
            AND "createdAt" >= ${since}
            AND "createdAt" < ${untilEnd}
          GROUP BY "batchId"
          UNION ALL
          SELECT DATE_TRUNC('day', MIN("createdAt")) as bucket
          FROM "Generation"
          WHERE "batchId" IS NULL
            AND "companyId" = ${companyId}
            AND "createdAt" >= ${since}
            AND "createdAt" < ${untilEnd}
          GROUP BY "sessionId"
        ) sub
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
    ]);

    // Merge into daily array
    const dateMap = new Map<string, { generates: number; images: number }>();

    for (const row of imgRows) {
      const key = row.bucket.toISOString().split("T")[0];
      if (!dateMap.has(key)) dateMap.set(key, { generates: 0, images: 0 });
      dateMap.get(key)!.images += Number(row.count);
    }

    for (const row of genRows) {
      const key = row.bucket.toISOString().split("T")[0];
      if (!dateMap.has(key)) dateMap.set(key, { generates: 0, images: 0 });
      dateMap.get(key)!.generates += Number(row.count);
    }

    const daily = [...dateMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([date, counts]) => ({ date, ...counts }));

    const totalImages = daily.reduce((s, d) => s + d.images, 0);
    const totalGenerates = daily.reduce((s, d) => s + d.generates, 0);

    return NextResponse.json({
      companyId,
      since: sinceStr,
      until: untilStr,
      totalGenerates,
      totalImages,
      daily,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Finance company API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
