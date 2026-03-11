import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ success: true });
  const isProduction = process.env.NODE_ENV === "production";

  // Clear cookie with domain (new format)
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
    ...(isProduction && { domain: ".snid.is" }),
  });

  // Also clear legacy cookie (without domain) in case it still exists
  if (isProduction) {
    response.headers.append(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
  }

  return response;
}
