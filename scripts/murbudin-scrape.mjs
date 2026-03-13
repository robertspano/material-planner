#!/usr/bin/env node
/**
 * Múrbúðin product scraper — scrapes all product categories from murbudin.is
 * via their WooCommerce Store API and imports into the Snið database.
 *
 * Usage: node scripts/murbudin-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const API_BASE = 'https://murbudin.is/wp-json/wc/store/v1/products';
const PER_PAGE = 100;

/** Categories to scrape — WooCommerce slug, mapped to Snið category */
const CATEGORIES = [
  { slug: 'golfflisar',   name: 'Gólfflísar',   surfaceType: 'both'  },
  { slug: 'veggflisar',   name: 'Veggflísar',   surfaceType: 'wall'  },
  { slug: 'hardparket',   name: 'Harðparket',   surfaceType: 'floor' },
  { slug: 'vinylparket',  name: 'Vínylparket',  surfaceType: 'floor' },
  { slug: 'mottur',       name: 'Mottur',       surfaceType: 'floor' },
  { slug: 'bilskursflisar-frosttolnar-flisar-ofl', name: 'Bílskúrsflísar', surfaceType: 'floor' },
  { slug: 'flisar',       name: 'Flísar',       surfaceType: 'both'  },
];

/** Fetch products from WooCommerce Store API */
async function fetchProducts(categorySlug, page = 1) {
  const url = `${API_BASE}?category=${categorySlug}&per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${categorySlug} page ${page}`);
  const total = parseInt(res.headers.get('x-wp-total') || '0');
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1');
  const items = await res.json();
  return { items, total, totalPages };
}

/** Parse dimensions from product name like "60x60cm" or "30x60 cm" or "120x20cm" */
function parseDimensions(text) {
  // Strip HTML tags
  const clean = text.replace(/<[^>]+>/g, ' ');
  // Match patterns: 60x60cm, 30x60 cm, 120x20cm, 60×120 cm
  const m = clean.match(/(\d+[,.]?\d*)\s*[x×]\s*(\d+[,.]?\d*)\s*(cm|mm)?/i);
  if (!m) return {};

  const unit = (m[3] || 'cm').toLowerCase();
  let v1 = parseFloat(m[1].replace(',', '.'));
  let v2 = parseFloat(m[2].replace(',', '.'));

  // Convert mm to cm
  if (unit === 'mm') {
    v1 = Math.round(v1 / 10 * 10) / 10;
    v2 = Math.round(v2 / 10 * 10) / 10;
  }

  // For tiles: width x height. If first is much larger, swap
  let tileWidth = v1;
  let tileHeight = v2;
  if (v1 > 200) {
    // Plank format: length x width → swap
    tileWidth = v2;
    tileHeight = v1;
  }

  return { tileWidth: tileWidth || null, tileHeight: tileHeight || null };
}

/** Calculate discount percent from regular and sale price */
function calcDiscount(regularPrice, salePrice) {
  const reg = parseInt(regularPrice);
  const sale = parseInt(salePrice);
  if (!reg || !sale || reg <= sale) return null;
  return Math.round((1 - sale / reg) * 100);
}

/** Determine unit from product description */
function parseUnit(description) {
  const clean = (description || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  if (clean.includes('verð á stk') || clean.includes('verð per stk') || clean.includes('verð á rúllu')) {
    return 'piece';
  }
  // Default to m2
  return 'm2';
}

async function main() {
  console.log('🏪 Múrbúðin product scraper\n');

  // Find the Múrbúðin company
  const company = await prisma.company.findUnique({ where: { slug: 'mrbin' } });
  if (!company) {
    console.error('❌ Company "mrbin" not found in database');
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
        if (seenIds.has(item.id)) continue; // Skip duplicates across categories
        seenIds.add(item.id);

        // Parse dimensions from name first, then from description
        let dims = parseDimensions(item.name || '');
        if (!dims.tileWidth) {
          dims = parseDimensions(item.short_description || '');
        }
        if (!dims.tileWidth) {
          dims = parseDimensions(item.description || '');
        }

        // Get price (WooCommerce Store API returns price as string in minor units or ISK integer)
        const price = item.prices?.price ? parseInt(item.prices.price) : null;
        const regularPrice = item.prices?.regular_price ? parseInt(item.prices.regular_price) : null;
        const salePrice = item.prices?.sale_price ? parseInt(item.prices.sale_price) : null;
        const discount = item.on_sale ? calcDiscount(item.prices?.regular_price, item.prices?.sale_price) : null;

        // Get images: first = swatch (material), last = room/installation
        const images = item.images || [];
        const swatchUrl = images[0]?.src || '';
        // Use last image as room/installation if there are multiple images
        const imageUrl = images.length > 1 ? images[images.length - 1]?.src || swatchUrl : swatchUrl;

        // Determine unit
        const unit = parseUnit(item.short_description || item.description || '');

        allProducts.push({
          name: item.name.trim(),
          price: price || null,
          unit,
          swatchUrl,
          imageUrl,
          category: cat.name,
          surfaceType: cat.surfaceType,
          tileWidth: dims.tileWidth || null,
          tileHeight: dims.tileHeight || null,
          tileThickness: null,
          discount,
          slug: item.slug,
        });
      }

      fetched += data.items.length;
      console.log(`   Page ${page}: ${data.items.length} items (${fetched}/${total})`);

      if (page >= data.totalPages) break;
      page++;
      await new Promise(r => setTimeout(r, 300)); // Be nice to their API
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
          unit: p.unit === 'piece' ? 'piece' : 'm2',
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
