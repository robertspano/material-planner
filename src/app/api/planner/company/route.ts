import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    // Always return company data (even inactive) for branding on lock screen
    const company = await getCompanyFromRequest({ includeInactive: true });

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // If company is inactive but user has the unlock cookie, treat as active
    const headersList = await headers();
    const cookieHeader = headersList.get("cookie") || "";
    const hasUnlockCookie = cookieHeader.includes("planner-unlock=1");
    const effectivelyActive = company.isActive || hasUnlockCookie;

    return NextResponse.json({
      id: company.id,
      name: company.name,
      slug: company.slug,
      kennitala: company.kennitala,
      logoUrl: company.logoUrl,
      loginBackgroundUrl: company.loginBackgroundUrl,
      primaryColor: company.primaryColor,
      secondaryColor: company.secondaryColor,
      isActive: effectivelyActive,
    }, {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
