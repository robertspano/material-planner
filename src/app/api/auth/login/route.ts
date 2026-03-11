import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createToken, COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const admin = await prisma.companyAdmin.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!admin) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = createToken({
      adminId: admin.id,
      companyId: admin.companyId,
      role: admin.role,
    });

    const response = NextResponse.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        companyId: admin.companyId,
        companyName: admin.company?.name || null,
        companySlug: admin.company?.slug || null,
      },
    });

    const isProduction = process.env.NODE_ENV === "production";

    // In production, set domain to .snid.is so cookie works on all subdomains
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
      ...(isProduction && { domain: ".snid.is" }),
    });

    // Clear any legacy cookie (set without domain) so it doesn't conflict
    if (isProduction) {
      response.headers.append(
        "Set-Cookie",
        `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
      );
    }

    return response;
  } catch (error) {
    console.error("Login error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Login failed: ${message}` }, { status: 500 });
  }
}
