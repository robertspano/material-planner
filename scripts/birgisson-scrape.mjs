#!/usr/bin/env node
/**
 * Birgisson product scraper — scrapes flooring products from birgisson.is
 * (Joomla CMS) and imports into the Snið database.
 *
 * Usage: node scripts/birgisson-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();
const BASE = 'https://birgisson.is';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'is,en;q=0.9',
};

/** Category listing pages to scrape */
const CATEGORY_PAGES = [
  { url: '/index.php/voerur/vidharparket',  category: 'Viðarparket',  surfaceType: 'floor' },
  { url: '/index.php/voerur/hardhparket',   category: 'Harðparket',   surfaceType: 'floor' },
  { url: '/index.php/voerur/vinylparket',   category: 'Vínylparket',  surfaceType: 'floor' },
  { url: '/index.php/voerur/flisar',        category: 'Flísar',       surfaceType: 'both'  },
];

/** Fetch a page */
async function fetchPage(url) {
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  const res = await fetch(fullUrl, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${fullUrl}`);
  return res.text();
}

/** Extract products from a listing page */
function extractListingProducts(html) {
  const $ = cheerio.load(html);
  const products = [];
  const seen = new Set();

  // Birgisson uses: <img class="img-responsive" alt="NAME"> followed by <a href="/index.php/voerur/.../item/..."><h3>NAME</h3></a>
  $('a[href*="/item/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.includes('/item/')) return;

    const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    // Get name from h3 inside the link
    let name = $(el).find('h3').first().text().trim();
    if (!name) name = $(el).text().trim();
    if (!name) return;

    // Find image - look for img.img-responsive near this link
    let imageUrl = null;
    const parent = $(el).parent();
    const grandparent = parent.parent();
    const container = grandparent.parent();

    // Try various approaches to find the product image
    for (const scope of [parent, grandparent, container]) {
      const img = scope.find('img.img-responsive').first();
      if (img.length) {
        imageUrl = img.attr('src') || img.attr('data-src') || null;
        break;
      }
    }

    // Also try looking at the previous sibling or parent's previous sibling
    if (!imageUrl) {
      const prevImg = $(el).prevAll('img.img-responsive').first();
      if (prevImg.length) {
        imageUrl = prevImg.attr('src') || null;
      }
    }

    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = `${BASE}${imageUrl}`;
    }

    products.push({ name, imageUrl, detailUrl: fullUrl });
  });

  return products;
}

/** Parse price from text. Handles "5.990 kr.", "12:990 kr.", "8.790 kr." */
function parsePrice(text) {
  if (!text) return null;
  // Replace : with . for consistent parsing (some pages use 12:990 instead of 12.990)
  const clean = text.replace(/:/g, '.').replace(/[^\d.]/g, '');
  // Remove dots used as thousand separators (e.g., "5.990" → "5990")
  const parts = clean.split('.');
  let numStr;
  if (parts.length > 1 && parts[parts.length - 1].length === 3) {
    // e.g., "5.990" → "5990", "15.990" → "15990"
    numStr = parts.join('');
  } else {
    numStr = clean;
  }
  const parsed = parseInt(numStr);
  if (!isNaN(parsed) && parsed > 0 && parsed < 10000000) return parsed;
  return null;
}

/** Fetch product detail page and extract price, dimensions, thickness */
async function fetchProductDetails(url) {
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const body = $('body').text();

    // Get the project description section
    const descSection = $('.project-description-content .text').text() || body;

    let price = null;
    let tileWidth = null;
    let tileHeight = null;
    let tileThickness = null;

    // Parse price — look for "Fermetraverð:", "Tilboðsverð:", "Útsöluverð:", "Verð:"
    const pricePatterns = [
      /(?:Fermetraverð|Tilboðsverð|Útsöluverð|Verð)\s*[:]\s*([\d.:]+)\s*kr/i,
    ];
    for (const pat of pricePatterns) {
      const m = descSection.match(pat);
      if (m) {
        price = parsePrice(m[1]);
        if (price) break;
      }
    }

    // Parse tile dimensions — "stærð 60x60", "stærð 30x60", etc.
    const dimMatch = descSection.match(/stærð\s*(\d+)\s*[x×]\s*(\d+)/i);
    if (dimMatch) {
      tileWidth = parseInt(dimMatch[1]);
      tileHeight = parseInt(dimMatch[2]);
    }

    // Also try matching NxN patterns from the full text (e.g., "60x60", "80x80")
    if (!tileWidth) {
      const generalDimMatch = descSection.match(/(\d+)\s*[x×]\s*(\d+)\s*(cm|mm)?/i);
      if (generalDimMatch) {
        let w = parseInt(generalDimMatch[1]);
        let h = parseInt(generalDimMatch[2]);
        const unit = (generalDimMatch[3] || 'cm').toLowerCase();
        if (unit === 'mm') { w = Math.round(w / 10); h = Math.round(h / 10); }
        // Only use if reasonable dimensions (not a random number)
        if (w >= 10 && w <= 200 && h >= 10 && h <= 200) {
          tileWidth = w;
          tileHeight = h;
        }
      }
    }

    // Parse thickness — "Þykkt: 15 mm"
    const thickMatch = descSection.match(/Þykkt\s*[:]\s*([\d,]+)\s*mm/i);
    if (thickMatch) {
      tileThickness = parseFloat(thickMatch[1].replace(',', '.'));
    }

    // Get better image from detail page
    let imageUrl = null;
    const mainImg = $('img.img-responsive').first();
    if (mainImg.length) {
      imageUrl = mainImg.attr('src') || null;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `${BASE}${imageUrl}`;
      }
    }
    // Also try og:image
    if (!imageUrl) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) imageUrl = ogImage;
    }

    return { price, tileWidth, tileHeight, tileThickness, imageUrl };
  } catch (err) {
    console.warn(`  ⚠ Could not fetch ${url}: ${err.message}`);
    return { price: null, tileWidth: null, tileHeight: null, tileThickness: null, imageUrl: null };
  }
}

async function main() {
  console.log('🏪 Birgisson Product Scraper\n');

  // Find company
  const company = await prisma.company.findUnique({ where: { slug: 'birgisson' } });
  if (!company) {
    console.error('❌ Company "birgisson" not found in database');
    process.exit(1);
  }
  console.log(`✅ Found company: ${company.name} (${company.id})\n`);

  // Clear existing
  console.log('🗑️  Clearing existing products and categories...');
  await prisma.product.deleteMany({ where: { companyId: company.id } });
  await prisma.category.deleteMany({ where: { companyId: company.id } });
  console.log('   Done.\n');

  // Scrape all categories
  const allProducts = [];
  const seenUrls = new Set();

  for (const cat of CATEGORY_PAGES) {
    console.log(`📂 Scraping listing: ${cat.category} — ${cat.url}`);
    try {
      const html = await fetchPage(cat.url);
      const products = extractListingProducts(html);
      console.log(`   Found ${products.length} products on listing page`);

      // Fetch details for each product
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (seenUrls.has(p.detailUrl)) continue;
        seenUrls.add(p.detailUrl);

        process.stdout.write(`   [${i + 1}/${products.length}] ${p.name.slice(0, 45).padEnd(45)} `);

        const details = await fetchProductDetails(p.detailUrl);

        // Use detail page image if listing image is missing
        if (!p.imageUrl && details.imageUrl) p.imageUrl = details.imageUrl;
        if (details.imageUrl) p.imageUrl = details.imageUrl; // Prefer detail page image

        allProducts.push({
          name: p.name,
          swatchUrl: p.imageUrl || null,  // Listing image = material/swatch
          imageUrl: p.imageUrl || '/placeholder-product.png',
          category: cat.category,
          surfaceType: cat.surfaceType,
          price: details.price,
          tileWidth: details.tileWidth,
          tileHeight: details.tileHeight,
          tileThickness: details.tileThickness,
        });

        const priceStr = details.price ? `${details.price} kr` : 'no price';
        const dimStr = details.tileWidth ? `${details.tileWidth}x${details.tileHeight}` : 'no dims';
        console.log(`→ ${priceStr}, ${dimStr}`);

        // Rate limit
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
    console.log('');
  }

  console.log(`\n📊 Total products: ${allProducts.length}`);

  // Count per category
  const catCounts = {};
  for (const p of allProducts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`   ${cat}: ${count}`);
  }

  const withPrice = allProducts.filter(p => p.price).length;
  const withDims = allProducts.filter(p => p.tileWidth).length;
  console.log(`   💰 With price: ${withPrice}/${allProducts.length}`);
  console.log(`   📐 With dimensions: ${withDims}/${allProducts.length}`);

  if (allProducts.length === 0) {
    console.log('No products found. Exiting.');
    process.exit(0);
  }

  // Create categories
  console.log('\n📁 Creating categories...');
  const catIds = {};
  let catSort = 1;
  for (const cat of CATEGORY_PAGES) {
    const count = catCounts[cat.category] || 0;
    if (count === 0) continue;
    const created = await prisma.category.create({
      data: {
        companyId: company.id,
        name: cat.category,
        surfaceType: cat.surfaceType,
        sortOrder: catSort++,
      },
    });
    catIds[cat.category] = created.id;
    console.log(`   ✅ ${cat.category} (${count} products)`);
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
        console.warn(`   ⚠ No category for "${p.name}"`);
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
          unit: 'm2',
          imageUrl: p.imageUrl,
          swatchUrl: p.swatchUrl || null,
          surfaceTypes,
          tileWidth: p.tileWidth,
          tileHeight: p.tileHeight,
          tileThickness: p.tileThickness,
          sortOrder: sortOrder++,
        },
      });

      imported++;
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
