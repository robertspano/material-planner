import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
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

    // Fetch actual saved quotes (created when user clicks "Sækja tilboð")
    const quotes = await prisma.quote.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const res = NextResponse.json(quotes);
    res.headers.set(
      "Cache-Control",
      "private, max-age=30, stale-while-revalidate=60",
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
