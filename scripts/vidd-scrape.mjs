#!/usr/bin/env node
/**
 * Vídd product scraper — scrapes all product categories from vidd.is
 * and imports them into the Snið database.
 *
 * Usage: node scripts/vidd-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'is,en;q=0.9',
};

/** Category pages on vidd.is and their Snið category mapping */
const CATEGORY_PAGES = [
  // Flísar (tiles)
  { url: 'https://vidd.is/flisar/', category: 'Flísar', surfaceType: 'both' },
  { url: 'https://vidd.is/marmaraflisar/', category: 'Marmaraflísar', surfaceType: 'both' },
  { url: 'https://vidd.is/steypu-flotgolfsutlit/', category: 'Steypuútlit', surfaceType: 'both' },
  { url: 'https://vidd.is/natturusteinsutlit/', category: 'Náttúrusteinsútlit', surfaceType: 'both' },
  { url: 'https://vidd.is/parketflisar/', category: 'Parketflísar', surfaceType: 'floor' },
  { url: 'https://vidd.is/mynstur-skrautflisar/', category: 'Mynstur & skrautflísar', surfaceType: 'both' },
  { url: 'https://vidd.is/malmflisar/', category: 'Málmflísar', surfaceType: 'both' },
  { url: 'https://vidd.is/terrazzo/', category: 'Terrazzo', surfaceType: 'both' },
  { url: 'https://vidd.is/flisahellur/', category: 'Flísahellur', surfaceType: 'floor' },
  { url: 'https://vidd.is/miniature/', category: 'Miniature', surfaceType: 'wall' },
  { url: 'https://vidd.is/multiforme/', category: 'Multiforme', surfaceType: 'wall' },
  // Parket (hardwood)
  { url: 'https://vidd.is/parket/', category: 'Parket', surfaceType: 'floor' },
];

/** Fetch a page with realistic headers */
async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Extract products from a category listing page */
function extractProducts(html, baseUrl) {
  const $ = cheerio.load(html);
  const products = [];
  const seen = new Set();

  // vidd.is uses WooCommerce — look for product links with /vara/ pattern
  $('a[href*="/vara/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.includes('/vara/')) return;

    const fullUrl = href.startsWith('http') ? href : `https://vidd.is${href}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    // Get the product card container (go up to find the card wrapper)
    const card = $(el).closest('.product, .product-item, .elementor-widget, article, li, .e-loop-item');

    // Try to get the product name
    let name = '';
    // Check for heading inside the link or card
    const heading = card.length ? card.find('h1, h2, h3, h4, h5, h6, .woocommerce-loop-product__title, .product-title').first() : null;
    if (heading && heading.length && heading.text().trim()) {
      name = heading.text().trim();
    } else {
      // Try the link text itself
      const linkText = $(el).text().trim();
      if (linkText && linkText.length > 2 && linkText.length < 100) {
        name = linkText;
      }
    }

    // Try to get image
    let imageUrl = null;
    const img = card.length ? card.find('img').first() : $(el).find('img').first();
    if (img.length) {
      imageUrl = img.attr('data-src') || img.attr('data-lazy-src') || img.attr('src') || null;
      if (imageUrl && !imageUrl.startsWith('http')) {
        imageUrl = `https://vidd.is${imageUrl}`;
      }
      // Skip tiny icons/placeholders
      if (imageUrl && (imageUrl.includes('placeholder') || imageUrl.includes('data:image'))) {
        imageUrl = null;
      }
    }

    // Try to get price
    let price = null;
    const priceEl = card.length ? card.find('.price, .woocommerce-Price-amount, [class*="price"]').first() : null;
    if (priceEl && priceEl.length) {
      const priceText = priceEl.text().replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(priceText);
      if (!isNaN(parsed) && parsed > 0 && parsed < 10000000) {
        price = parsed;
      }
    }

    if (name) {
      products.push({ name, imageUrl, price, sourceUrl: fullUrl });
    }
  });

  return products;
}

/** Fetch product detail page for extra info (dimensions, description, better image) */
async function fetchProductDetails(url) {
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);

    // Get main product image (higher res)
    let imageUrl = null;
    const mainImg = $('img.wp-post-image, .woocommerce-product-gallery__image img, .product-image img, .elementor-widget-theme-post-featured-image img').first();
    if (mainImg.length) {
      imageUrl = mainImg.attr('data-src') || mainImg.attr('data-large_image') || mainImg.attr('src') || null;
      if (imageUrl && !imageUrl.startsWith('http')) imageUrl = `https://vidd.is${imageUrl}`;
    }
    // Also try og:image
    if (!imageUrl) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) imageUrl = ogImage;
    }

    // Get description
    let description = null;
    const descEl = $('.woocommerce-product-details__short-description, .product-description, .elementor-widget-theme-post-content').first();
    if (descEl.length) {
      description = descEl.text().trim().slice(0, 300) || null;
    }

    // Try to extract dimensions from text content
    let tileWidth = null, tileHeight = null;
    const fullText = $('body').text();

    // Match patterns like "60x60", "60×120", "120x120 cm"
    const dimMatch = fullText.match(/(\d+)\s*[x×]\s*(\d+)\s*(cm|mm)?/i);
    if (dimMatch) {
      let w = parseInt(dimMatch[1]);
      let h = parseInt(dimMatch[2]);
      const unit = dimMatch[3]?.toLowerCase();
      if (unit === 'mm') { w = w / 10; h = h / 10; }
      if (w > 0 && w <= 300 && h > 0 && h <= 300) {
        tileWidth = w;
        tileHeight = h;
      }
    }

    // Get price if available
    let price = null;
    const priceEl = $('.price .woocommerce-Price-amount, .product-price, ins .woocommerce-Price-amount').first();
    if (priceEl.length) {
      const priceText = priceEl.text().replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(priceText);
      if (!isNaN(parsed) && parsed > 0) price = parsed;
    }

    return { imageUrl, description, tileWidth, tileHeight, price };
  } catch (err) {
    console.warn(`  ⚠ Could not fetch details for ${url}: ${err.message}`);
    return { imageUrl: null, description: null, tileWidth: null, tileHeight: null, price: null };
  }
}

/** Scrape parket page (different structure — prices shown on listing) */
function extractParketProducts(html) {
  const $ = cheerio.load(html);
  const products = [];
  const seen = new Set();

  // Parket products have prices and dimensions in the listing
  $('a[href*="/vara/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.includes('/vara/')) return;
    const fullUrl = href.startsWith('http') ? href : `https://vidd.is${href}`;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const card = $(el).closest('.product, .product-item, .elementor-widget, article, li, .e-loop-item, div');
    let name = '';
    const heading = card.length ? card.find('h1, h2, h3, h4, h5, h6').first() : null;
    if (heading && heading.length) name = heading.text().trim();
    if (!name) name = $(el).text().trim();

    let imageUrl = null;
    const img = card.length ? card.find('img').first() : $(el).find('img').first();
    if (img.length) {
      imageUrl = img.attr('data-src') || img.attr('src') || null;
      if (imageUrl && !imageUrl.startsWith('http')) imageUrl = `https://vidd.is${imageUrl}`;
    }

    if (name && name.length > 2 && name.length < 100) {
      products.push({ name, imageUrl, price: null, sourceUrl: fullUrl });
    }
  });

  return products;
}

async function main() {
  console.log('🏪 Vídd Product Scraper');
  console.log('=======================\n');

  // Find Vídd company
  const company = await prisma.company.findUnique({ where: { slug: 'vdd' } });
  if (!company) {
    console.error('❌ Company "vidd" not found. Create it first in super admin.');
    process.exit(1);
  }
  console.log(`✅ Found company: ${company.name} (${company.id})\n`);

  // Collect all products from all category pages
  const allProducts = [];
  const categoryMap = {};

  for (const cat of CATEGORY_PAGES) {
    console.log(`📂 Scraping: ${cat.category} — ${cat.url}`);
    try {
      const html = await fetchPage(cat.url);
      const products = cat.url.includes('/parket/')
        ? extractParketProducts(html)
        : extractProducts(html, cat.url);

      console.log(`   Found ${products.length} products on listing page`);

      // Fetch details for each product
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        process.stdout.write(`   Fetching details ${i + 1}/${products.length}: ${p.name.slice(0, 40)}...`);

        const details = await fetchProductDetails(p.sourceUrl);

        // Use higher-res image from detail page if available
        if (details.imageUrl) p.imageUrl = details.imageUrl;
        p.description = details.description;
        p.tileWidth = details.tileWidth;
        p.tileHeight = details.tileHeight;
        if (details.price && !p.price) p.price = details.price;
        p.category = cat.category;
        p.surfaceType = cat.surfaceType;

        console.log(` ✓`);

        // Small delay to be nice
        await new Promise(r => setTimeout(r, 300));
      }

      allProducts.push(...products);
      categoryMap[cat.category] = cat.surfaceType;
    } catch (err) {
      console.error(`   ❌ Error scraping ${cat.url}: ${err.message}`);
    }
    console.log('');
  }

  // Deduplicate by name
  const uniqueProducts = [];
  const seenNames = new Set();
  for (const p of allProducts) {
    const key = p.name.toLowerCase().trim();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    uniqueProducts.push(p);
  }

  console.log(`\n📊 Total unique products scraped: ${uniqueProducts.length}`);
  console.log(`   (${allProducts.length - uniqueProducts.length} duplicates removed)\n`);

  if (uniqueProducts.length === 0) {
    console.log('No products found. Exiting.');
    process.exit(0);
  }

  // Delete existing Vídd products (clean slate)
  const existingCount = await prisma.product.count({ where: { companyId: company.id } });
  if (existingCount > 0) {
    console.log(`🗑️  Deleting ${existingCount} existing products...`);
    await prisma.product.deleteMany({ where: { companyId: company.id } });
  }

  // Delete existing categories too
  const existingCats = await prisma.category.count({ where: { companyId: company.id } });
  if (existingCats > 0) {
    console.log(`🗑️  Deleting ${existingCats} existing categories...`);
    await prisma.category.deleteMany({ where: { companyId: company.id } });
  }

  // Create categories
  console.log('\n📁 Creating categories...');
  const catIds = {};
  let catSort = 1;
  for (const [catName, surfaceType] of Object.entries(categoryMap)) {
    const cat = await prisma.category.create({
      data: {
        companyId: company.id,
        name: catName,
        surfaceType,
        sortOrder: catSort++,
      },
    });
    catIds[catName] = cat.id;
    console.log(`   ✅ ${catName} (${cat.id})`);
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
        console.warn(`   ⚠ No category for "${p.name}" (${p.category})`);
        failed++;
        continue;
      }

      // Determine surface types
      const surfaceTypes = p.surfaceType === 'both' ? ['floor', 'wall'] : [p.surfaceType || 'floor'];

      // Use the image URL directly (vidd.is images are public webp)
      const imageUrl = p.imageUrl || '/placeholder-product.png';

      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          description: p.description || null,
          price: p.price,
          unit: 'm2',
          imageUrl,
          surfaceTypes,
          tileWidth: p.tileWidth,
          tileHeight: p.tileHeight,
          sortOrder: sortOrder++,
        },
      });

      imported++;
      if (imported % 10 === 0) console.log(`   ${imported}/${uniqueProducts.length} imported...`);
    } catch (err) {
      console.error(`   ❌ Failed to import "${p.name}": ${err.message}`);
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
