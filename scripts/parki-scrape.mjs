#!/usr/bin/env node
/**
 * Parki product scraper — scrapes all product categories from parki.is
 * via their backend API and imports into the Snið database.
 *
 * Usage: node scripts/parki-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const API_BASE = 'https://parki-newbackend-144662703168.europe-west1.run.app/';
const PAGE_SIZE = 50;

/** Categories to scrape — slug used for API filter, mapped to Snið category */
const CATEGORIES = [
  { slug: 'parket',       name: 'Parket',       surfaceType: 'floor' },
  { slug: 'hardparket',   name: 'Harðparket',   surfaceType: 'floor' },
  { slug: 'vinyl-parket', name: 'Vínylparket',  surfaceType: 'floor' },
  { slug: 'flisar',       name: 'Flísar',       surfaceType: 'both'  },
  { slug: 'golfteppi',    name: 'Gólfteppi',    surfaceType: 'floor' },
];

/** Fetch products from Parki API */
async function fetchProducts(categorySlug, page = 1) {
  const res = await fetch(API_BASE + 'product/filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      active: true,
      size: PAGE_SIZE,
      page,
      category_slug: categorySlug,
      is_parent: true,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${categorySlug} page ${page}`);
  const data = await res.json();
  return data.data; // { items, total, page, size }
}

/** Parse dimensions from product title like "1517,7x235x6 mm" or "60x60" */
function parseDimensions(title) {
  // Try patterns like: 60x60, 60x120, 1517,7x235x6, 908,1x451x2,5
  const m = title.match(/(\d+[,.]?\d*)\s*[x×]\s*(\d+[,.]?\d*)(?:\s*[x×]\s*(\d+[,.]?\d*))?\s*(mm|cm)?/i);
  if (!m) return {};

  const unit = (m[4] || 'mm').toLowerCase();
  let v1 = parseFloat(m[1].replace(',', '.'));
  let v2 = parseFloat(m[2].replace(',', '.'));
  let v3 = m[3] ? parseFloat(m[3].replace(',', '.')) : null;

  // Convert mm to cm
  if (unit === 'mm') {
    v1 = Math.round(v1 / 10 * 10) / 10;
    v2 = Math.round(v2 / 10 * 10) / 10;
    if (v3) v3 = Math.round(v3 / 10 * 10) / 10;
  }

  // If first value is much larger (>200cm), it's length — use v2 as width
  // For tiles: width x height
  let tileWidth, tileHeight, tileThickness;

  if (v1 > 200) {
    // Long plank format: length x width x thickness (e.g., 1517x235x6 mm → 152x24 cm)
    // For planks we use width x length
    tileWidth = v2;
    tileHeight = v1;
    tileThickness = v3;
  } else {
    tileWidth = v1;
    tileHeight = v2;
    tileThickness = v3;
  }

  return { tileWidth: tileWidth || null, tileHeight: tileHeight || null, tileThickness: tileThickness || null };
}

/** Also try parsing from product fields width/height */
function getDimensions(product) {
  // First try from title
  const fromTitle = parseDimensions(product.title || '');
  if (fromTitle.tileWidth && fromTitle.tileHeight) return fromTitle;

  // Fallback: product width/height fields (in mm)
  if (product.width && product.height) {
    return {
      tileWidth: Math.round(product.width / 10 * 10) / 10,
      tileHeight: Math.round(product.height / 10 * 10) / 10,
      tileThickness: null,
    };
  }

  return fromTitle;
}

async function main() {
  console.log('🏪 Parki product scraper\n');

  // Find the Parki company
  const company = await prisma.company.findUnique({ where: { slug: 'parki' } });
  if (!company) {
    console.error('❌ Company "parki" not found in database');
    process.exit(1);
  }
  console.log(`✅ Found company: ${company.name} (${company.id})\n`);

  // Clear existing products and categories for this company
  console.log('🗑️  Clearing existing products and categories...');
  await prisma.product.deleteMany({ where: { companyId: company.id } });
  await prisma.category.deleteMany({ where: { companyId: company.id } });
  console.log('   Done.\n');

  // Scrape all categories
  const allProducts = [];
  const seenIds = new Set();

  for (const cat of CATEGORIES) {
    console.log(`📂 Scraping ${cat.name} (${cat.slug})...`);

    let page = 1;
    let total = 0;
    let fetched = 0;

    while (true) {
      const data = await fetchProducts(cat.slug, page);
      total = data.total;

      if (!data.items || data.items.length === 0) break;

      for (const item of data.items) {
        const pid = item.product.id;
        if (seenIds.has(pid)) continue; // Skip duplicates across categories
        seenIds.add(pid);

        const dims = getDimensions(item.product);

        // First image = swatch/material, last image = room/installation
        const pictures = item.pictures || [];
        const swatchUrl = pictures[0]?.path || '';
        const imageUrl = pictures.length > 1 ? pictures[pictures.length - 1]?.path || swatchUrl : swatchUrl;

        allProducts.push({
          name: item.product.title.trim(),
          price: item.product.price_with_vat || null,
          unit: item.product.unit_code || 'm2',
          swatchUrl,
          imageUrl,
          category: cat.name,
          surfaceType: cat.surfaceType,
          tileWidth: dims.tileWidth,
          tileHeight: dims.tileHeight,
          tileThickness: dims.tileThickness,
          discount: item.product.discount || 0,
          slug: item.product.slug,
        });
      }

      fetched += data.items.length;
      console.log(`   Page ${page}: ${data.items.length} items (${fetched}/${total})`);

      if (fetched >= total) break;
      page++;
      await new Promise(r => setTimeout(r, 200)); // Be nice to their API
    }

    console.log(`   ✅ ${cat.name}: ${total} total\n`);
  }

  console.log(`📊 Total unique products: ${allProducts.length}\n`);

  // Count per category
  const catCounts = {};
  for (const p of allProducts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }

  // Create categories
  console.log('📁 Creating categories...');
  const catIds = {};
  let catSort = 1;
  for (const cat of CATEGORIES) {
    const count = catCounts[cat.name] || 0;
    if (count === 0) continue;
    const created = await prisma.category.create({
      data: {
        companyId: company.id,
        name: cat.name,
        surfaceType: cat.surfaceType,
        sortOrder: catSort++,
      },
    });
    catIds[cat.name] = created.id;
    console.log(`   ✅ ${cat.name} (${count} products)`);
  }

  // Import products
  console.log(`\n📦 Importing ${allProducts.length} products...\n`);
  let imported = 0;
  let failed = 0;
  let sortOrder = 1;

  for (const p of allProducts) {
    try {
      const categoryId = catIds[p.category];
      if (!categoryId) {
        console.warn(`   ⚠ No category for "${p.name}" (${p.category})`);
        failed++;
        continue;
      }

      const surfaceTypes = p.surfaceType === 'both' ? ['floor', 'wall'] : [p.surfaceType || 'floor'];

      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          price: p.price,
          unit: p.unit === 'stk' ? 'piece' : 'm2',
          imageUrl: p.imageUrl || '/placeholder-product.png',
          swatchUrl: p.swatchUrl || null,
          surfaceTypes,
          tileWidth: p.tileWidth,
          tileHeight: p.tileHeight,
          tileThickness: p.tileThickness,
          discountPercent: p.discount > 0 ? p.discount : null,
          sortOrder: sortOrder++,
        },
      });

      imported++;
      if (imported % 20 === 0) console.log(`   ${imported}/${allProducts.length} imported...`);
    } catch (err) {
      console.error(`   ❌ Failed: "${p.name}": ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${allProducts.length}`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
