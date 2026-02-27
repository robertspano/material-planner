import { PrismaClient } from "../src/generated/prisma/index.js";
const prisma = new PrismaClient();

async function main() {
  const missing = await prisma.product.findMany({
    where: { tileWidth: null },
    select: { name: true, description: true, category: { select: { name: true } } },
    orderBy: { category: { name: "asc" } },
  });
  console.log("Products WITHOUT dimensions:", missing.length);
  console.log("");

  const byCat = {};
  for (const p of missing) {
    const cat = p.category.name;
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push({ name: p.name, desc: p.description });
  }
  for (const [cat, prods] of Object.entries(byCat)) {
    console.log(`=== ${cat} (${prods.length}) ===`);
    for (const p of prods) {
      console.log(`  ${p.name}  |  desc: "${p.desc || ""}"`);
    }
    console.log("");
  }
  await prisma.$disconnect();
}
main();
