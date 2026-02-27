import { PrismaClient } from "../src/generated/prisma";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create super admin
  const superAdminPassword = await bcrypt.hash("admin123", 12);
  const superAdmin = await prisma.companyAdmin.upsert({
    where: { email: "admin@planner.is" },
    update: {},
    create: {
      email: "admin@planner.is",
      passwordHash: superAdminPassword,
      name: "Super Admin",
      role: "super_admin",
      companyId: null,
    },
  });
  console.log(`Super admin created: ${superAdmin.email}`);

  // Create demo company
  const demoCompany = await prisma.company.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Retailer",
      slug: "demo",
      primaryColor: "#2e7cff",
      secondaryColor: "#1e293b",
      monthlyGenerationLimit: 100,
    },
  });
  console.log(`Demo company created: ${demoCompany.name} (${demoCompany.slug})`);

  // Create company admin for demo
  const companyAdminPassword = await bcrypt.hash("demo123", 12);
  const companyAdmin = await prisma.companyAdmin.upsert({
    where: { email: "admin@demo.is" },
    update: {},
    create: {
      email: "admin@demo.is",
      passwordHash: companyAdminPassword,
      name: "Demo Admin",
      role: "admin",
      companyId: demoCompany.id,
    },
  });
  console.log(`Company admin created: ${companyAdmin.email}`);

  // Create categories for demo company
  const floorCategory = await prisma.category.upsert({
    where: { id: "cat-floor-parket" },
    update: {},
    create: {
      id: "cat-floor-parket",
      companyId: demoCompany.id,
      name: "Parket",
      surfaceType: "floor",
      sortOrder: 1,
    },
  });

  const tilesCategory = await prisma.category.upsert({
    where: { id: "cat-floor-tiles" },
    update: {},
    create: {
      id: "cat-floor-tiles",
      companyId: demoCompany.id,
      name: "Flísar",
      surfaceType: "both",
      sortOrder: 2,
    },
  });

  const wallCategory = await prisma.category.upsert({
    where: { id: "cat-wall-paint" },
    update: {},
    create: {
      id: "cat-wall-paint",
      companyId: demoCompany.id,
      name: "Veggefni",
      surfaceType: "wall",
      sortOrder: 3,
    },
  });

  console.log(`Categories created: ${floorCategory.name}, ${tilesCategory.name}, ${wallCategory.name}`);

  // Create sample products
  const products = [
    {
      id: "prod-1",
      companyId: demoCompany.id,
      categoryId: floorCategory.id,
      name: "Eik Natural 3-strip",
      description: "Klassískt eikparket með náttúrulegum lit",
      price: 4500,
      unit: "m2",
      imageUrl: "/placeholder-product.jpg",
      surfaceTypes: ["floor"],
      sortOrder: 1,
    },
    {
      id: "prod-2",
      companyId: demoCompany.id,
      categoryId: floorCategory.id,
      name: "Askur Premium",
      description: "Ljóst askparket, skandínavískt útlit",
      price: 5200,
      unit: "m2",
      imageUrl: "/placeholder-product.jpg",
      surfaceTypes: ["floor"],
      sortOrder: 2,
    },
    {
      id: "prod-3",
      companyId: demoCompany.id,
      categoryId: tilesCategory.id,
      name: "Carrara White Marble",
      description: "Hvítar marmara flísar, 60x60cm",
      price: 8900,
      unit: "m2",
      imageUrl: "/placeholder-product.jpg",
      surfaceTypes: ["floor", "wall"],
      sortOrder: 1,
    },
    {
      id: "prod-4",
      companyId: demoCompany.id,
      categoryId: wallCategory.id,
      name: "Concrete Effect Grey",
      description: "Steinsteypt útlit, grátt",
      price: 3200,
      unit: "m2",
      imageUrl: "/placeholder-product.jpg",
      surfaceTypes: ["wall"],
      sortOrder: 1,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { id: product.id },
      update: {},
      create: product,
    });
  }
  console.log(`${products.length} sample products created`);

  // Create a second demo company (Byko)
  const bykoCompany = await prisma.company.upsert({
    where: { slug: "byko" },
    update: {},
    create: {
      name: "Byko",
      slug: "byko",
      primaryColor: "#e31837",
      secondaryColor: "#1a1a1a",
      monthlyGenerationLimit: 500,
    },
  });
  console.log(`Company created: ${bykoCompany.name} (${bykoCompany.slug})`);

  const bykoAdminPassword = await bcrypt.hash("byko123", 12);
  await prisma.companyAdmin.upsert({
    where: { email: "admin@byko.is" },
    update: {},
    create: {
      email: "admin@byko.is",
      passwordHash: bykoAdminPassword,
      name: "Byko Admin",
      role: "admin",
      companyId: bykoCompany.id,
    },
  });

  console.log("\nSeed complete!");
  console.log("\nLogin credentials:");
  console.log("  Super Admin: admin@planner.is / admin123");
  console.log("  Demo Admin:  admin@demo.is / demo123");
  console.log("  Byko Admin:  admin@byko.is / byko123");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
