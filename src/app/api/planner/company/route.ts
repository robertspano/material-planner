import { NextResponse } from "next/server";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    // Always return company data (even inactive) for branding on lock screen
    const company = await getCompanyFromRequest({ includeInactive: true });

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: company.id,
      name: company.name,
      slug: company.slug,
      kennitala: company.kennitala,
      logoUrl: company.logoUrl,
      loginBackgroundUrl: company.loginBackgroundUrl,
      primaryColor: company.primaryColor,
      secondaryColor: company.secondaryColor,
      isActive: company.isActive,
    }, {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
