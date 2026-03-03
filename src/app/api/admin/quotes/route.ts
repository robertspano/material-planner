import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAuth();
    const companyFromHeader = await getCompanyFromRequest();
    const companyId =
      admin.role === "super_admin" ? companyFromHeader?.id : admin.companyId;

    if (!companyId) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 },
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period"); // "week" | "month" | "3months" | "all"
    const search = searchParams.get("search") || "";

    // Build date filter
    let dateFilter: Date | undefined;
    if (period === "week") {
      dateFilter = new Date();
      dateFilter.setDate(dateFilter.getDate() - 7);
    } else if (period === "month") {
      dateFilter = new Date();
      dateFilter.setMonth(dateFilter.getMonth() - 1);
    } else if (period === "3months") {
      dateFilter = new Date();
      dateFilter.setMonth(dateFilter.getMonth() - 3);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = { companyId };
    if (dateFilter) {
      where.createdAt = { gte: dateFilter };
    }
    if (search) {
      where.OR = [
        { customerEmail: { contains: search, mode: "insensitive" } },
        { productNames: { hasSome: [search] } },
      ];
    }

    const quotes = await prisma.quote.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const res = NextResponse.json(quotes);
    res.headers.set(
      "Cache-Control",
      "private, max-age=10, stale-while-revalidate=30",
    );
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Quotes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
