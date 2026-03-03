#!/usr/bin/env node

/**
 * Fix missing swatchUrls by copying from sibling products with the same name.
 * Also enlarges coverage by matching product families.
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findUnique({ where: { slug: 'alfaborg' } });

  const allProducts = await prisma.product.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true, description: true, swatchUrl: true },
  });

  const withSwatch = allProducts.filter(p => p.swatchUrl);
  const noSwatch = allProducts.filter(p => !p.swatchUrl);

  console.log('Products with swatchUrl:', withSwatch.length);
  console.log('Products without swatchUrl:', noSwatch.length);

  // 1. Fix by exact name match (same product name, different size/variant)
  const nameSwatchMap = {};
  withSwatch.forEach(p => {
    if (!nameSwatchMap[p.name]) {
      nameSwatchMap[p.name] = p.swatchUrl;
    }
  });

  let nameFixCount = 0;
  for (const p of noSwatch) {
    if (nameSwatchMap[p.name]) {
      await prisma.product.update({
        where: { id: p.id },
        data: { swatchUrl: nameSwatchMap[p.name] },
      });
      nameFixCount++;
      console.log(`  Name match: ${p.name} - ${p.description || ''}`);
    }
  }
  console.log(`\nFixed ${nameFixCount} products by exact name match\n`);

  // Refresh
  const remaining = await prisma.product.findMany({
    where: { companyId: company.id, swatchUrl: null },
    select: { id: true, name: true, description: true },
  });

  // 2. Fix by product family (first 2+ words of name)
  // Rebuild withSwatch after name fixes
  const updatedProducts = await prisma.product.findMany({
    where: { companyId: company.id, swatchUrl: { not: null } },
    select: { name: true, swatchUrl: true },
  });

  const familyMap = {};
  updatedProducts.forEach(p => {
    const words = p.name.split(/\s+/);
    for (let len = Math.min(words.length, 3); len >= 2; len--) {
      const key = words.slice(0, len).join(' ');
      if (!familyMap[key]) familyMap[key] = new Set();
      familyMap[key].add(p.swatchUrl);
    }
  });

  let familyFixCount = 0;
  for (const p of remaining) {
    const words = p.name.split(/\s+/);
    // Try longer prefixes first
    for (let len = Math.min(words.length, 3); len >= 2; len--) {
      const key = words.slice(0, len).join(' ');
      const urls = familyMap[key];
      if (urls && urls.size === 1) {
        await prisma.product.update({
          where: { id: p.id },
          data: { swatchUrl: [...urls][0] },
        });
        familyFixCount++;
        console.log(`  Family match (${key}): ${p.name} - ${p.description || ''}`);
        break;
      }
    }
  }
  console.log(`\nFixed ${familyFixCount} products by family match\n`);

  // Final summary
  const finalCount = await prisma.product.count({
    where: { companyId: company.id, swatchUrl: { not: null } },
  });
  const total = await prisma.product.count({ where: { companyId: company.id } });
  console.log(`Final: ${finalCount}/${total} products with swatchUrl`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
