import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, hashPassword } from "@/lib/auth";

export async function GET() {
  try {
    await requireSuperAdmin();

    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: {
            products: true,
            generations: true,
            admins: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(companies);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const { name, slug, kennitala, logoUrl, logoIsLight, primaryColor, secondaryColor, monthlyGenerationLimit, adminName, adminEmail, adminPassword } = await request.json();

    if (!name || !slug) {
      return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: "Slug must contain only lowercase letters, numbers, and hyphens" }, { status: 400 });
    }

    // Check for reserved slugs
    if (["admin", "api", "www", "app", "demo"].includes(slug)) {
      return NextResponse.json({ error: "This slug is reserved" }, { status: 400 });
    }

    const existing = await prisma.company.findUnique({ where: { slug } });
    if (existing) {
      return NextResponse.json({ error: "A company with this slug already exists" }, { status: 409 });
    }

    // Check admin email uniqueness if provided
    if (adminEmail) {
      const existingAdmin = await prisma.companyAdmin.findUnique({ where: { email: adminEmail } });
      if (existingAdmin) {
        return NextResponse.json({ error: "An admin with this email already exists" }, { status: 409 });
      }
    }

    // Create company + admin in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name,
          slug,
          kennitala: kennitala || null,
          logoUrl: logoUrl || null,
          logoIsLight: logoIsLight || false,
          primaryColor: primaryColor || "#2e7cff",
          secondaryColor: secondaryColor || "#1e293b",
          monthlyGenerationLimit: monthlyGenerationLimit || 500,
        },
      });

      // Create admin if provided
      let admin = null;
      if (adminEmail && adminPassword && adminName) {
        const passwordHash = await hashPassword(adminPassword);
        admin = await tx.companyAdmin.create({
          data: {
            email: adminEmail,
            passwordHash,
            plainPassword: adminPassword,
            name: adminName,
            role: "admin",
            companyId: company.id,
          },
        });
      }

      return { company, admin };
    });

    return NextResponse.json(result.company, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Create company error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
