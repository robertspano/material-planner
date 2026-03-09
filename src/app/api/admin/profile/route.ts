import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, hashPassword, verifyPassword } from "@/lib/auth";

export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAuth();

    const { email, currentPassword, newPassword } = await request.json();

    if (!currentPassword) {
      return NextResponse.json(
        { error: "Núverandi lykilorð vantar" },
        { status: 400 }
      );
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, admin.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Rangt lykilorð" },
        { status: 401 }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Update email if changed
    if (email && email !== admin.email) {
      // Check uniqueness
      const existing = await prisma.companyAdmin.findUnique({
        where: { email },
      });
      if (existing && existing.id !== admin.id) {
        return NextResponse.json(
          { error: "Netfang er nú þegar í notkun" },
          { status: 409 }
        );
      }
      updateData.email = email;
    }

    // Update password if provided
    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json(
          { error: "Lykilorð verður að vera a.m.k. 6 stafir" },
          { status: 400 }
        );
      }
      updateData.passwordHash = await hashPassword(newPassword);
      updateData.plainPassword = newPassword;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Engar breytingar" },
        { status: 400 }
      );
    }

    const updated = await prisma.companyAdmin.update({
      where: { id: admin.id },
      data: updateData,
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Profile update error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
