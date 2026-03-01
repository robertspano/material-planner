import { NextResponse } from "next/server";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function GET() {
  try {
    const company = await getCompanyFromRequest();

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: company.id,
      name: company.name,
      slug: company.slug,
      kennitala: company.kennitala,
      logoUrl: company.logoUrl,
      primaryColor: company.primaryColor,
      secondaryColor: company.secondaryColor,
    }, {
      headers: { "Cache-Control": "private, no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
