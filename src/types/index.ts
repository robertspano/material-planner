// Re-export Prisma types for convenience
export type {
  Company,
  CompanyAdmin,
  Category,
  Product,
  Generation,
  GenerationProduct,
  GenerationResult,
} from "@/generated/prisma";

// Frontend-specific types (not in Prisma schema)

export interface CompanyBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface AdminStats {
  totalCompanies: number;
  activeCompanies: number;
  totalProducts: number;
  totalGenerations: number;
  generationsThisMonth: number;
  totalGenerates: number;
  generationsByCompany: { companyName: string; imageCount: number; generateCount: number }[];
}

export interface CompanyStats {
  totalProducts: number;
  totalCategories: number;
  totalGenerations: number;
  generationsThisMonth: number;
  generationLimit: number;
  generationsUsed: number;
}

export interface MaterialEstimate {
  productId: string;
  productName: string;
  surfaceArea: number; // m2
  wasteFactor: number; // e.g. 0.10
  totalNeeded: number; // m2 with waste
  pricePerUnit: number | null;
  totalPrice: number | null;
  unit: string;
}

export interface SessionInfo {
  sessionId: string;
  companyId: string;
}
