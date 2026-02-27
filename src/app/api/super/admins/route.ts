import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, hashPassword } from "@/lib/auth";

export async function GET() {
  try {
    await requireSuperAdmin();

    const admins = await prisma.companyAdmin.findMany({
      include: { company: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Don't send password hashes, but include plainPassword for super admin
    return NextResponse.json(
      admins.map(({ passwordHash: _, ...admin }) => admin)
    );
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const { email, password, name, companyId, role } = await request.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "Email, password, and name are required" }, { status: 400 });
    }

    const existing = await prisma.companyAdmin.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "An admin with this email already exists" }, { status: 409 });
    }

    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId } });
      if (!company) {
        return NextResponse.json({ error: "Company not found" }, { status: 404 });
      }
    }

    const passwordHash = await hashPassword(password);

    const admin = await prisma.companyAdmin.create({
      data: {
        email,
        passwordHash,
        plainPassword: password,
        name,
        companyId: companyId || null,
        role: role || "admin",
      },
      include: { company: { select: { id: true, name: true, slug: true } } },
    });

    const { passwordHash: _, ...adminWithoutPassword } = admin;
    return NextResponse.json(adminWithoutPassword, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
