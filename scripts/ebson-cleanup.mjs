#!/usr/bin/env node
import { PrismaClient } from '../src/generated/prisma/index.js';
const prisma = new PrismaClient();
const COMPANY_ID = 'cmmdncfk40000lb04z6l1yj8l';

async function main() {
  // 1. Delete products with no images
  const deleted = await prisma.product.deleteMany({
    where: {
      companyId: COMPANY_ID,
      OR: [
        { imageUrl: '/placeholder-product.jpg' },
        { imageUrl: '' },
      ]
    }
  });
  console.log(`Deleted ${deleted.count} products with no images`);

  // 2. Remove duplicates (keep the one with swatch, or first by sortOrder)
  const all = await prisma.product.findMany({
    where: { companyId: COMPANY_ID },
    select: { id: true, name: true, categoryId: true, sortOrder: true, swatchUrl: true },
    orderBy: { sortOrder: 'asc' }
  });

  const seen = {};
  const toDelete = [];
  for (const p of all) {
    const key = `${p.name}|${p.categoryId}`;
    if (seen[key]) {
      const existing = seen[key];
      if (!existing.swatchUrl && p.swatchUrl) {
        toDelete.push(existing.id);
        seen[key] = p;
      } else {
        toDelete.push(p.id);
      }
    } else {
      seen[key] = p;
    }
  }

  if (toDelete.length > 0) {
    const deletedDupes = await prisma.product.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log(`Deleted ${deletedDupes.count} duplicate products`);
  } else {
    console.log('No duplicates found');
  }

  // 3. Summary
  const remaining = await prisma.product.count({ where: { companyId: COMPANY_ID } });
  console.log(`\nRemaining products: ${remaining}`);

  const cats = await prisma.category.findMany({
    where: { companyId: COMPANY_ID },
    include: { _count: { select: { products: true } } }
  });
  cats.forEach(c => console.log(`  ${c.name}: ${c._count.products}`));

  // Also check if any remaining have no image
  const noImg = await prisma.product.count({
    where: { companyId: COMPANY_ID, imageUrl: '/placeholder-product.jpg' }
  });
  console.log(`\nStill without images: ${noImg}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
