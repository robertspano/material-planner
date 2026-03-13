#!/usr/bin/env node
/**
 * Flísabúðin (flis.is) product scraper — scrapes tile collections from
 * the WooCommerce Store API and splits them into individual product variants.
 *
 * Each collection on flis.is has multiple color/variant images.
 * We create one product per image variant.
 *
 * Usage: node scripts/flis-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const API_BASE = 'https://flis.is/wp-json/wc/store/v1/products';
const PER_PAGE = 100;

/** Categories to scrape */
const CATEGORIES = [
  { slug: 'flisar', name: 'Flísar', surfaceType: 'both' },
  { slug: 'outlet', name: 'Outlet', surfaceType: 'both' },
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

/** Clean up image name to create a nice variant name */
function cleanImageName(imgName) {
  if (!imgName) return '';
  return imgName
    .replace(/[-_]/g, ' ')        // Replace dashes/underscores with spaces
    .replace(/\d{3,}x\d{3,}/g, '') // Remove resolution numbers like 500x500
    .replace(/\b(min|grip|en|l)\b/gi, '') // Remove common suffixes
    .replace(/\s+/g, ' ')
    .trim();
}

/** Check if an image is likely a gallery/lifestyle shot rather than a product variant */
function isGalleryImage(img) {
  const name = (img.name || '').toLowerCase();
  const src = (img.src || '').toLowerCase();

  // Skip gallery/lifestyle/room shots
  if (name.includes('gallery') || name.includes('room') || name.includes('ambience') ||
      name.includes('lifestyle') || name.includes('interior') || name.includes('setting')) {
    return true;
  }

  return false;
}

/** Parse dimensions from description text (e.g., "60x60", "30x60 cm") */
function parseDimensions(text) {
  if (!text) return {};
  const clean = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');

  // Find all dimension patterns
  const dims = [];
  const regex = /(\d+[,.]?\d*)\s*[x×]\s*(\d+[,.]?\d*)\s*(cm|mm)?/gi;
  let m;
  while ((m = regex.exec(clean)) !== null) {
    let w = parseFloat(m[1].replace(',', '.'));
    let h = parseFloat(m[2].replace(',', '.'));
    const unit = (m[3] || 'cm').toLowerCase();
    if (unit === 'mm') { w = Math.round(w / 10); h = Math.round(h / 10); }
    // Only reasonable tile sizes (not resolution numbers like 500x500 pixels)
    if (w >= 2 && w <= 200 && h >= 2 && h <= 200) {
      dims.push({ w, h });
    }
  }

  if (dims.length === 0) return {};

  // Use the most common/representative dimension (prefer 60x60, 30x60, etc.)
  // If multiple sizes, pick the first reasonable one
  const preferred = dims.find(d => d.w >= 20 && d.h >= 20) || dims[0];
  return { tileWidth: preferred.w, tileHeight: preferred.h };
}

/** Calculate discount percent */
function calcDiscount(regularPrice, salePrice) {
  const reg = parseInt(regularPrice);
  const sale = parseInt(salePrice);
  if (!reg || !sale || reg <= sale) return null;
  return Math.round((1 - sale / reg) * 100);
}

async function main() {
  console.log('🏪 Flísabúðin (flis.is) Product Scraper\n');

  // Find the company
  const company = await prisma.company.findUnique({ where: { slug: 'flsabin' } });
  if (!company) {
    console.error('❌ Company "flsabin" not found in database');
    process.exit(1);
  }
  console.log(`✅ Found company: ${company.name} (${company.id})\n`);

  // Clear existing products and categories
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
    while (true) {
      const data = await fetchProducts(cat.slug, page);
      if (!data.items || data.items.length === 0) break;

      for (const item of data.items) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);

        const collectionName = item.name.trim();
        const description = item.description || '';
        const dims = parseDimensions(description);

        // Get price (collections have 0, outlet has real prices)
        const price = item.prices?.price ? parseInt(item.prices.price) : null;
        const regularPrice = item.prices?.regular_price ? parseInt(item.prices.regular_price) : null;
        const discount = item.on_sale ? calcDiscount(regularPrice, price) : null;

        // Filter out gallery images
        const productImages = (item.images || []).filter(img => !isGalleryImage(img));

        // Find gallery/room images for this collection (installation photos)
        const galleryImages = (item.images || []).filter(img => isGalleryImage(img));
        const roomImageUrl = galleryImages[0]?.src || '';

        if (price && price > 0) {
          // Outlet / priced products — import as single product
          const swatchUrl = productImages[0]?.src || item.images?.[0]?.src || '';
          allProducts.push({
            name: collectionName,
            swatchUrl,
            imageUrl: roomImageUrl || swatchUrl,
            category: cat.name,
            surfaceType: cat.surfaceType,
            price: price || null,
            discount,
            tileWidth: dims.tileWidth || null,
            tileHeight: dims.tileHeight || null,
          });
        } else if (productImages.length > 0) {
          // Collection — split into variants (one per image)
          for (const img of productImages) {
            const variantName = cleanImageName(img.name || img.alt || '');
            const fullName = variantName
              ? `${collectionName} - ${variantName}`
              : collectionName;

            const swatchUrl = img.src || '';
            allProducts.push({
              name: fullName,
              swatchUrl,
              imageUrl: roomImageUrl || swatchUrl,
              category: cat.name,
              surfaceType: cat.surfaceType,
              price: null,
              discount: null,
              tileWidth: dims.tileWidth || null,
              tileHeight: dims.tileHeight || null,
            });
          }
        }
      }

      console.log(`   Page ${page}: ${data.items.length} collections → ${allProducts.length} products so far`);
      if (page >= data.totalPages) break;
      page++;
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Deduplicate by image URL
  const uniqueByImage = new Map();
  for (const p of allProducts) {
    const key = p.imageUrl || p.name;
    if (!uniqueByImage.has(key)) {
      uniqueByImage.set(key, p);
    }
  }
  const uniqueProducts = [...uniqueByImage.values()];

  console.log(`\n📊 Total: ${allProducts.length} raw → ${uniqueProducts.length} unique products`);

  // Count per category
  const catCounts = {};
  for (const p of uniqueProducts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`   ${cat}: ${count}`);
  }

  const withPrice = uniqueProducts.filter(p => p.price).length;
  const withDims = uniqueProducts.filter(p => p.tileWidth).length;
  console.log(`   💰 With price: ${withPrice}/${uniqueProducts.length}`);
  console.log(`   📐 With dimensions: ${withDims}/${uniqueProducts.length}`);

  if (uniqueProducts.length === 0) {
    console.log('No products found. Exiting.');
    process.exit(0);
  }

  // Create categories
  console.log('\n📁 Creating categories...');
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
  console.log(`\n📦 Importing ${uniqueProducts.length} products...\n`);
  let imported = 0;
  let failed = 0;
  let sortOrder = 1;

  for (const p of uniqueProducts) {
    try {
      const categoryId = catIds[p.category];
      if (!categoryId) {
        failed++;
        continue;
      }

      const surfaceTypes = p.surfaceType === 'both' ? ['floor', 'wall'] : [p.surfaceType || 'floor'];

      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          price: p.price || null,
          unit: 'm2',
          imageUrl: p.imageUrl || '/placeholder-product.png',
          swatchUrl: p.swatchUrl || null,
          surfaceTypes,
          tileWidth: p.tileWidth,
          tileHeight: p.tileHeight,
          discountPercent: p.discount > 0 ? p.discount : null,
          sortOrder: sortOrder++,
        },
      });

      imported++;
      if (imported % 50 === 0) console.log(`   ${imported}/${uniqueProducts.length} imported...`);
    } catch (err) {
      console.error(`   ❌ Failed: "${p.name}": ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total: ${uniqueProducts.length}`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
