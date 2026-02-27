import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import type { CompanyAdmin } from "@/generated/prisma";
import { cookies } from "next/headers";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const TOKEN_EXPIRY = "7d";
const COOKIE_NAME = "planner_token";

export interface JWTPayload {
  adminId: string;
  companyId: string | null;
  role: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Get the currently authenticated admin from the request cookie.
 * Returns null if not authenticated.
 */
export async function getAuthenticatedAdmin(): Promise<CompanyAdmin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const admin = await prisma.companyAdmin.findUnique({
    where: { id: payload.adminId },
  });

  return admin;
}

/**
 * Require authentication. Returns the admin or throws a Response.
 */
export async function requireAuth(): Promise<CompanyAdmin> {
  const admin = await getAuthenticatedAdmin();
  if (!admin) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return admin;
}

/**
 * Require super admin role.
 */
export async function requireSuperAdmin(): Promise<CompanyAdmin> {
  const admin = await requireAuth();
  if (admin.role !== "super_admin") {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return admin;
}

/**
 * Require company admin role, scoped to a specific company.
 */
export async function requireCompanyAdmin(companyId: string): Promise<CompanyAdmin> {
  const admin = await requireAuth();
  if (admin.role === "super_admin") return admin;
  if (admin.companyId !== companyId) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return admin;
}

export { COOKIE_NAME };
