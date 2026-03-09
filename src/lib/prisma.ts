import { PrismaClient } from "@/generated/prisma";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
    // Limit connections to avoid exhausting Supabase pool
    ...(process.env.NODE_ENV === "production" && {
      log: ["error"],
    }),
  });

// Cache in ALL environments to prevent connection pool exhaustion on serverless
globalForPrisma.prisma = prisma;
