import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, hashPassword } from "@/lib/auth";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const data = await request.json();

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.password) {
      updateData.passwordHash = await hashPassword(data.password);
      updateData.plainPassword = data.password;
    }

    const admin = await prisma.companyAdmin.update({
      where: { id },
      data: updateData,
      include: { company: { select: { id: true, name: true, slug: true } } },
    });

    const { passwordHash: _, ...adminWithoutPassword } = admin;
    return NextResponse.json(adminWithoutPassword);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Update admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
