import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const admin = await getAuthenticatedAdmin();

    if (!admin) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const company = admin.companyId
      ? await prisma.company.findUnique({ where: { id: admin.companyId } })
      : null;

    return NextResponse.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        companyId: admin.companyId,
        companyName: company?.name || null,
        companySlug: company?.slug || null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
