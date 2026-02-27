import { prisma } from "./prisma";
import type { Company } from "@/generated/prisma";
import { headers } from "next/headers";

/**
 * Resolve company from the x-company-slug header set by middleware.
 * Returns null if company not found or inactive.
 */
export async function getCompanyFromRequest(): Promise<Company | null> {
  const headersList = await headers();
  const slug = headersList.get("x-company-slug");

  if (!slug) return null;

  const company = await prisma.company.findUnique({
    where: { slug, isActive: true },
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
