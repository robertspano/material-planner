/**
 * Fix the last 5 products without dimensions.
 *
 * Manual products (demo data):
 * - prod-1: Eik Natural 3-strip (oak parquet 3-strip) → 19.8×228.1 cm (standard Barlinek 3-strip)
 * - prod-2: Askur Premium (ash parquet) → 19.8×228.1 cm (standard Barlinek)
 * - prod-4: Concrete Effect Grey (tile) → 60×60 cm (standard large tile)
 *
 * Álfaborg products:
 * - THE ROOM GRE R06 12 RM (marble-look tile from Equipe) → 59.6×119.5 cm (standard large format)
 * - HERITAGE OAK HARDVAX OIL 14MM (Barlinek Heritage) → 19×200 cm (matches other Heritage products)
 *
 * Run: node scripts/fix-remaining-dims.mjs
 */

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

const fixes = [
  { id: "prod-1", tileWidth: 19.8, tileHeight: 228.1, tileThickness: 14 },  // Eik Natural 3-strip
  { id: "prod-2", tileWidth: 19.8, tileHeight: 228.1, tileThickness: 14 },  // Askur Premium
  { id: "prod-4", tileWidth: 60, tileHeight: 60, tileThickness: null },       // Concrete Effect Grey
  { id: "alfa-the-room-gre-r06-12-rm-355", tileWidth: 59.6, tileHeight: 119.5, tileThickness: null }, // THE ROOM large marble tile
  { id: "alfa-heritage-oak-hardvax-oil-14mm-660", tileWidth: 19, tileHeight: 200, tileThickness: 14 }, // HERITAGE OAK (matches other Heritage)
];

async function main() {
  for (const fix of fixes) {
    try {
      await prisma.product.update({
        where: { id: fix.id },
        data: {
          tileWidth: fix.tileWidth,
          tileHeight: fix.tileHeight,
          ...(fix.tileThickness !== null && { tileThickness: fix.tileThickness }),
        },
      });
      console.log(`  ✓ ${fix.id}: ${fix.tileWidth}×${fix.tileHeight} cm`);
    } catch (err) {
      console.error(`  ✗ ${fix.id}: ${err.message}`);
    }
  }

  const totalWithDims = await prisma.product.count({ where: { tileWidth: { not: null } } });
  const totalProducts = await prisma.product.count();
  console.log(`\nFinal: ${totalWithDims}/${totalProducts} products have dimensions`);

  // Verify none remain
  const remaining = await prisma.product.findMany({
    where: { tileWidth: null },
    select: { id: true, name: true },
  });
  if (remaining.length === 0) {
    console.log("🎉 ALL products have dimensions!");
  } else {
    console.log(`Still missing: ${remaining.map(r => r.name).join(", ")}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
