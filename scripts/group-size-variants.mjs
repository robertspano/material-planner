#!/usr/bin/env node
/**
 * Group Size Variants
 * Finds products with the same name in the same category and groups them
 * as parent/variant using parentProductId. The variant with the largest
 * tile dimensions (or highest price) becomes the parent.
 *
 * Usage: node scripts/group-size-variants.mjs
 */

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

function makeSizeLabel(product) {
  if (product.tileWidth && product.tileHeight) {
    // Use clean numbers (no trailing .0)
    const w = Number.isInteger(product.tileWidth) ? product.tileWidth : product.tileWidth.toFixed(1);
    const h = Number.isInteger(product.tileHeight) ? product.tileHeight : product.tileHeight.toFixed(1);
    return `${w}×${h} cm`;
  }
  return null;
}

function tileArea(product) {
  if (product.tileWidth && product.tileHeight) {
    return product.tileWidth * product.tileHeight;
  }
  return 0;
}

async function main() {
  console.log("🔗 Group Size Variants\n");

  const companies = await prisma.company.findMany();

  let totalGrouped = 0;
  let totalVariants = 0;

  for (const company of companies) {
    console.log(`\n=== ${company.name} (${company.slug}) ===`);

    // Get all products that don't already have a parent
    const products = await prisma.product.findMany({
      where: { companyId: company.id, parentProductId: null },
      orderBy: { name: "asc" },
    });

    // Group by exact name + categoryId
    const groups = {};
    for (const p of products) {
      const key = `${p.categoryId}|||${p.name}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    // Find groups with more than one product (= size variants)
    const multiGroups = Object.entries(groups).filter(([, items]) => items.length > 1);
    console.log(`  Products: ${products.length}, Groups with variants: ${multiGroups.length}`);

    let companyGrouped = 0;
    let companyVariants = 0;

    for (const [, items] of multiGroups) {
      // Sort by tile area (largest first), then by price
      items.sort((a, b) => {
        const areaDiff = tileArea(b) - tileArea(a);
        if (areaDiff !== 0) return areaDiff;
        return (b.price || 0) - (a.price || 0);
      });

      const parent = items[0]; // Largest tile = parent
      const variants = items.slice(1);

      // Generate size labels for all including parent
      const parentLabel = makeSizeLabel(parent);
      const updates = [];

      // Update parent's sizeLabel
      if (parentLabel) {
        updates.push(
          prisma.product.update({
            where: { id: parent.id },
            data: { sizeLabel: parentLabel },
          })
        );
      }

      // Update variants: set parentProductId + sizeLabel
      for (const v of variants) {
        const label = makeSizeLabel(v);
        updates.push(
          prisma.product.update({
            where: { id: v.id },
            data: {
              parentProductId: parent.id,
              sizeLabel: label,
            },
          })
        );
      }

      await Promise.all(updates);

      companyGrouped++;
      companyVariants += variants.length;

      if (variants.length >= 3) {
        console.log(`  📦 "${parent.name}" — ${items.length} sizes (parent: ${parentLabel || "?"})`);
      }
    }

    if (companyGrouped > 0) {
      console.log(`  ✅ Grouped ${companyGrouped} products, ${companyVariants} variants`);
    } else {
      console.log("  ✅ No size duplicates found");
    }

    totalGrouped += companyGrouped;
    totalVariants += companyVariants;
  }

  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Total grouped: ${totalGrouped}`);
  console.log(`Total variants: ${totalVariants}`);
  console.log(`Products saved from display: ${totalVariants} (these now appear as size options)`);

  // Verify counts
  const parentCount = await prisma.product.count({ where: { parentProductId: null } });
  const variantCount = await prisma.product.count({ where: { parentProductId: { not: null } } });
  console.log(`\nDB state: ${parentCount} parent products, ${variantCount} variants`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
