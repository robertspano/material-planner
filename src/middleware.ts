import { NextRequest, NextResponse } from "next/server";

/**
 * Multi-tenant subdomain routing middleware.
 *
 * Extracts the company slug from the subdomain:
 *   byko.planner.is      → slug = "byko"
 *   admin.planner.is     → super admin mode
 *   localhost:3000        → dev mode (uses query param ?company=byko or defaults to "demo")
 *
 * Sets headers:
 *   x-company-slug: the tenant slug
 *   x-is-super-admin: "true" if admin subdomain
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const response = NextResponse.next();

  // Always check for ?company= query param (used by admin pages to scope API calls)
  const companyParam = request.nextUrl.searchParams.get("company");

  // Dev mode: use ?company= query param or x-company header
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    const companyHeader = request.headers.get("x-company");
    const slug = companyParam || companyHeader || "demo";

    if (slug === "admin") {
      response.headers.set("x-is-super-admin", "true");
    } else {
      response.headers.set("x-company-slug", slug);
    }
    return response;
  }

  // Vercel preview/hosting domains should use query param, not subdomain
  const isVercelDomain = hostname.includes("vercel.app") || hostname.includes("vercel.sh");

  if (isVercelDomain) {
    const slug = companyParam || "demo";
    if (slug === "admin") {
      response.headers.set("x-is-super-admin", "true");
      if (companyParam) {
        response.headers.set("x-company-slug", companyParam);
      }
    } else {
      response.headers.set("x-company-slug", slug);
    }
    return response;
  }

  // Production: extract subdomain
  // hostname = "byko.planner.is" → parts = ["byko", "planner", "is"]
  const parts = hostname.split(".");

  if (parts.length >= 3) {
    const subdomain = parts[0];

    if (subdomain === "admin") {
      response.headers.set("x-is-super-admin", "true");
      // Super admin API calls pass ?company= to scope to a specific company
      if (companyParam) {
        response.headers.set("x-company-slug", companyParam);
      }
    } else {
      response.headers.set("x-company-slug", subdomain);
    }
  } else {
    // No subdomain - could be the root domain
    response.headers.set("x-company-slug", companyParam || "demo");
  }

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
