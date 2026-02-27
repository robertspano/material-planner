import { NextRequest, NextResponse } from "next/server";

/**
 * Multi-tenant subdomain routing middleware.
 *
 * Production (snid.is):
 *   alfaborg.snid.is   → slug = "alfaborg" (company planner)
 *   byko.snid.is       → slug = "byko"
 *   admin.snid.is      → super admin mode
 *   snid.is            → landing page (no company slug)
 *
 * Vercel preview:
 *   material-planner.vercel.app?company=alfaborg → slug = "alfaborg"
 *
 * Dev (localhost):
 *   localhost:3000?company=byko → slug = "byko"
 *   localhost:3000?company=admin → super admin mode
 *   localhost:3000/landing → landing page preview
 *
 * Sets headers:
 *   x-company-slug: the tenant slug
 *   x-is-super-admin: "true" if admin subdomain
 *   x-is-landing: "true" if root domain (no subdomain)
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const response = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  // Always check for ?company= query param (used by admin pages to scope API calls)
  const companyParam = request.nextUrl.searchParams.get("company");

  // Dev mode: use ?company= query param or x-company header
  if (hostname.includes("localhost") || hostname.includes("127.0.0.1")) {
    // Allow previewing landing page at /landing in dev
    if (pathname === "/landing") {
      response.headers.set("x-is-landing", "true");
      return response;
    }

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
  const isVercelDomain =
    hostname.includes("vercel.app") || hostname.includes("vercel.sh");

  if (isVercelDomain) {
    // Allow landing page preview on Vercel
    if (pathname === "/landing") {
      response.headers.set("x-is-landing", "true");
      return response;
    }

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
  // hostname = "alfaborg.snid.is" → parts = ["alfaborg", "snid", "is"]
  const parts = hostname.split(".");

  if (parts.length >= 3) {
    // Has subdomain: alfaborg.snid.is, admin.snid.is, etc.
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
    // No subdomain: snid.is → show landing page
    // Unless ?company= is specified (for direct access)
    if (companyParam) {
      if (companyParam === "admin") {
        response.headers.set("x-is-super-admin", "true");
      } else {
        response.headers.set("x-company-slug", companyParam);
      }
    } else {
      // Root domain with no params → rewrite to landing page
      response.headers.set("x-is-landing", "true");
      return NextResponse.rewrite(new URL("/landing", request.url), {
        headers: response.headers,
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
