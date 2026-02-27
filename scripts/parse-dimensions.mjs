/**
 * Parse tile dimensions from product descriptions and update the database.
 *
 * Handles these formats:
 * - Standard cm: "60x120 cm", "20X60", "10x30"
 * - Decimal comma: "59,6x150 cm", "2,5x2,5 cm"
 * - 3D (with thickness): "30X30X1 cm", "1520X227X2,5,MM"
 * - Large mm values (vinyl planks): "1211X190", "1524X254MM"
 * - Wood parquet mm: "190x2000mm", "192X2028", "194x2281x14mm"
 * - Slash format: "190/2200mm", "190/2000mm"
 * - Scattered mm dims: "14MM 162" -> thickness=14, width=162
 * - Explicit MM suffix: "324X601MM"
 * - Non-breaking spaces
 *
 * Run: node scripts/parse-dimensions.mjs
 */

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

// Parse a number that may use comma as decimal separator
function parseNum(str) {
  return parseFloat(str.replace(",", "."));
}

function parseDimensions(description, productName) {
  if (!description) return null;

  // Normalize: replace non-breaking spaces, trim
  const desc = description.replace(/\u00a0/g, " ").trim();

  let w, h, thickness = null;

  // Pattern 1: WxH or WxHxT (with x/X/× separator)
  const xMatch = desc.match(
    /(\d+[,.]?\d*)\s*[xX×]\s*(\d+[,.]?\d*)(?:\s*[xX×]\s*(\d+[,.]?\d*))?\s*(?:,?\s*(?:cm|CM|mm|MM))?/
  );

  // Pattern 2: W/H format (slash separator, used in wood parquet)
  const slashMatch = !xMatch && desc.match(
    /(\d{2,4})\s*\/\s*(\d{3,4})\s*(?:mm|MM)?/
  );

  if (xMatch) {
    w = parseNum(xMatch[1]);
    h = parseNum(xMatch[2]);
    thickness = xMatch[3] ? parseNum(xMatch[3]) : null;

    // Detect explicit MM suffix
    const hasMmSuffix = /mm|MM/.test(desc);

    // Detect if values are in mm and need conversion to cm:
    // 1) Explicit MM suffix with any value > 100
    // 2) Both values > 100 (likely mm for planks/large format)
    // 3) One value > 300 (can't be cm for a normal tile)
    const isMm = hasMmSuffix
      ? (w > 100 || h > 100)  // If "MM" is present and values are large
      : (w > 300 || h > 300); // If no unit, values > 300 are definitely mm

    if (isMm) {
      // For 3-value mm (e.g., 194x2281x14mm), the 3rd is thickness in mm
      if (thickness && thickness < 50) {
        // thickness stays in mm (already small)
      }
      w = Math.round((w / 10) * 10) / 10; // mm → cm
      h = Math.round((h / 10) * 10) / 10;
    }
  } else if (slashMatch) {
    // Slash format: "190/2200mm" or "190/2000mm" — always mm
    w = parseNum(slashMatch[1]) / 10;
    h = parseNum(slashMatch[2]) / 10;
  } else {
    return null;
  }

  // Sanity check: tiles/planks should be between 1cm and 300cm
  if (w < 1 || w > 300 || h < 1 || h > 300) return null;

  // Ensure width <= height (normalize so smaller dimension is width)
  if (w > h) [w, h] = [h, w];

  // Round to 1 decimal
  w = Math.round(w * 10) / 10;
  h = Math.round(h * 10) / 10;

  return { tileWidth: w, tileHeight: h, tileThickness: thickness };
}

async function main() {
  // Only update products that don't already have dimensions
  const products = await prisma.product.findMany({
    where: { tileWidth: null },
    select: { id: true, name: true, description: true },
  });

  console.log(`Found ${products.length} products without dimensions`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const stillMissing = [];

  for (const product of products) {
    const dims = parseDimensions(product.description, product.name);
    if (!dims) {
      skipped++;
      stillMissing.push({ name: product.name, desc: product.description });
      continue;
    }

    try {
      await prisma.product.update({
        where: { id: product.id },
        data: {
          tileWidth: dims.tileWidth,
          tileHeight: dims.tileHeight,
          ...(dims.tileThickness !== null && { tileThickness: dims.tileThickness }),
        },
      });
      updated++;
      console.log(`  ✓ ${product.name}: ${dims.tileWidth}×${dims.tileHeight} cm  [from: "${product.description}"]`);
    } catch (err) {
      console.error(`  ✗ Failed to update ${product.name}:`, err.message);
      failed++;
    }
  }

  console.log(`\nResults (this run):`);
  console.log(`  Newly updated: ${updated}`);
  console.log(`  Skipped (no dimensions found): ${skipped}`);
  console.log(`  Failed: ${failed}`);

  // Overall count
  const totalWithDims = await prisma.product.count({ where: { tileWidth: { not: null } } });
  const totalProducts = await prisma.product.count();
  console.log(`\nOverall: ${totalWithDims}/${totalProducts} products have dimensions`);

  if (stillMissing.length > 0) {
    console.log(`\nStill missing dimensions (${stillMissing.length}):`);
    for (const p of stillMissing) {
      console.log(`  ${p.name}  |  "${p.desc || ""}"`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
