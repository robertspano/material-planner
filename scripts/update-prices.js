const { PrismaClient } = require('../src/generated/prisma');
const prisma = new PrismaClient();

/**
 * Match sale products from alfaborg.is to our database products
 * and update prices using the ORIGINAL price (not sale price).
 *
 * Sale data was scraped from /tilbodsvorur/ pages on alfaborg.is
 */

// Sale products with original prices (per fm = per square meter)
// These are the ORIGINAL prices (Verð áður), which is the regular price
const SALE_PRICE_MAP = [
  // Náttúrusteinsútlit
  { dbName: "PIERRE DES REVES REVEILLE", size: "60x60", originalPrice: 8990 },
  { dbName: "PIERRE DES REVES AURORE", size: "60x60", originalPrice: 8990 },
  { dbName: "PIERRE DES REVES NUAGE", size: "60x60", originalPrice: 8990 },
  { dbName: "FRAME PEAK", size: "60x60", originalPrice: 8990 },
  { dbName: "FRAME RIVER", size: "60x60", originalPrice: 8990 },
  { dbName: "INTEGRA SILVER", size: "60x60", originalPrice: 8490 },
  { dbName: "THE ROCK NEGRES", size: "120x260", originalPrice: 16990 },

  // Steypuútlit
  { dbName: "ORIGINI CAPPUCCINO", size: "60x60", originalPrice: 7490 },
  { dbName: "COSMOPOLITA GREY", size: "60x60", originalPrice: 8490 },

  // Marmaraútlit
  { dbName: "THE ROOM INV WH6 260 LP", size: "120x260", originalPrice: 34990 },

  // Viðarútlit flísar
  { dbName: "Mother Mirra6", size: "20x120", originalPrice: 8990 },

  // Lauslimt parket (LVT vinyl)
  { dbName: "SPIRIT PRO - LVT VÍNYLPARKET SMELLT", desc: "DARK BROWN CL", originalPrice: 7690 },
  { dbName: "SPIRIT PRO - LVT VÍNYLPARKET SMELLT", desc: "BROWN CL", originalPrice: 7690 },
  { dbName: "SPIRIT PRO - LVT VÍNYLPARKET SMELLT", desc: "ELITE NATURAL", originalPrice: 7690 },

  // Harðparket
  { dbName: "CONNECT XL8", desc: "BLOOM SAND NATURAL", originalPrice: 5890 },
];

async function main() {
  const company = await prisma.company.findFirst({ where: { slug: 'alfaborg' } });
  if (!company) {
    console.error('Alfaborg company not found');
    process.exit(1);
  }

  let updated = 0;
  let notFound = 0;

  for (const item of SALE_PRICE_MAP) {
    // Build query
    const where = {
      companyId: company.id,
      name: { contains: item.dbName, mode: 'insensitive' },
    };

    // Find matching products
    let products = await prisma.product.findMany({ where });

    // If we have a specific size, filter by dimensions
    if (item.size && products.length > 1) {
      const [w, h] = item.size.split('x').map(Number);
      products = products.filter(p => {
        // Match by tile dimensions (allowing some tolerance)
        if (p.tileWidth && p.tileHeight) {
          return (Math.abs(p.tileWidth - w) < 1 && Math.abs(p.tileHeight - h) < 1);
        }
        return true;
      });
    }

    // If we have a description match, filter further
    if (item.desc && products.length > 1) {
      products = products.filter(p =>
        p.description && p.description.toUpperCase().includes(item.desc.toUpperCase())
      );
    }

    if (products.length === 0) {
      console.log(`  ✗ NOT FOUND: ${item.dbName} ${item.size || ''} ${item.desc || ''}`);
      notFound++;
      continue;
    }

    for (const product of products) {
      await prisma.product.update({
        where: { id: product.id },
        data: { price: item.originalPrice },
      });
      console.log(`  ✓ Updated: ${product.name} (${product.description?.substring(0, 40)}) → ${item.originalPrice} kr/fm`);
      updated++;
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Updated: ${updated} products`);
  console.log(`Not found: ${notFound} items`);

  // Show how many still have no price
  const noPrice = await prisma.product.count({
    where: { companyId: company.id, price: null },
  });
  const total = await prisma.product.count({
    where: { companyId: company.id },
  });
  console.log(`\nProducts with price: ${total - noPrice}/${total}`);
  console.log(`Products without price: ${noPrice}/${total}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
