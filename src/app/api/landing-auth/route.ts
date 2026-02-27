import { NextRequest, NextResponse } from "next/server";

const PASSWORD = "2404";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    if (password !== PASSWORD) {
      return NextResponse.json({ error: "Rangt lykilorð" }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set("snid-pw", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch {
    return NextResponse.json({ error: "Villa" }, { status: 400 });
  }
}
