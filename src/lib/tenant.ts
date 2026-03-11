import { prisma } from "./prisma";
import type { Company } from "@/generated/prisma";
import { headers } from "next/headers";

/**
 * Resolve company from the x-company-slug header set by middleware.
 * By default only returns active companies. Pass includeInactive=true
 * for pages like login that should show branding regardless.
 */
export async function getCompanyFromRequest(opts?: { includeInactive?: boolean }): Promise<Company | null> {
  const headersList = await headers();
  const slug = headersList.get("x-company-slug");

  if (!slug) return null;

  // Check for planner-unlock cookie — allows access to inactive companies
  const cookieHeader = headersList.get("cookie") || "";
  const hasUnlockCookie = cookieHeader.includes("planner-unlock=1");
  const includeInactive = opts?.includeInactive || hasUnlockCookie;

  const company = await prisma.company.findUnique({
    where: includeInactive ? { slug } : { slug, isActive: true },
  });

  return company || null;
}

/**
 * Get company by slug directly (for middleware or non-request contexts).
 */
export async function getCompanyBySlug(slug: string): Promise<Company | null> {
  const company = await prisma.company.findUnique({
    where: { slug },
  });

  if (!company || !company.isActive) return null;

  return company;
}

/**
 * Check if the current request is for the super admin subdomain.
 */
export async function isSuperAdminRequest(): Promise<boolean> {
  const headersList = await headers();
  return headersList.get("x-is-super-admin") === "true";
}
