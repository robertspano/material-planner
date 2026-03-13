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
  // Parket (hardwood) — special plain-text page, no WooCommerce
  { url: 'https://vidd.is/parket/', category: 'Parket', surfaceType: 'floor' },
];

/** Fetch a page with realistic headers */
async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/** Extract a readable product name from a URL slug */
function nameFromSlug(url) {
  const match = url.match(/\/vara\/([^/]+)\/?$/);
  if (!match) return '';
  return match[1]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
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

    // Try to get the product name (multiple fallback strategies)
    let name = '';

    // 1. Check for heading inside the card
    const heading = card.length ? card.find('h1, h2, h3, h4, h5, h6, .woocommerce-loop-product__title, .product-title').first() : null;
    if (heading && heading.length && heading.text().trim()) {
      name = heading.text().trim();
    }

    // 2. Try the link text itself
    if (!name) {
      const linkText = $(el).text().trim();
      if (linkText && linkText.length > 2 && linkText.length < 100) {
        name = linkText;
      }
    }

    // 3. Try image alt text inside the link
    if (!name) {
      const imgAlt = $(el).find('img').first().attr('alt');
      if (imgAlt && imgAlt.length > 2 && imgAlt.length < 100) {
        name = imgAlt.trim();
      }
    }

    // 4. Extract name from URL slug as last resort
    if (!name) {
      name = nameFromSlug(fullUrl);
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

    // Try to get price from listing
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

/** Extract parket products from plain text listing (no WooCommerce) */
function extractParketProducts(html) {
  const $ = cheerio.load(html);
  const products = [];

  // The parket page lists products as plain text with <strong> tags
  // Pattern: "PRODUCT – VARIANT" with dimensions and prices in nearby text
  const bodyText = $('body').text();

  // Find all product entries: "ProductName – Variant" or "ProductName - Variant"
  // followed by dimensions and price
  const sections = bodyText.split(/\n/);
  let currentProduct = null;

  for (const line of sections) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match product names like "Essence – Naturalizzato", "Vulcano – Etna"
    const nameMatch = trimmed.match(/^([A-Z][a-záéíóúýðþæö]+(?:\s+[A-Z][a-záéíóúýðþæö]*)*)\s*[–-]\s*(.+?)$/i);
    if (nameMatch && !trimmed.includes('kr') && !trimmed.includes('cm') && trimmed.length < 60) {
      if (currentProduct && currentProduct.name) {
        products.push(currentProduct);
      }
      currentProduct = {
        name: `${nameMatch[1].trim()} ${nameMatch[2].trim()}`,
        imageUrl: null,
        price: null,
        sourceUrl: 'https://vidd.is/parket/',
        tileWidth: null,
        tileHeight: null,
      };
      continue;
    }

    if (!currentProduct) continue;

    // Match dimensions like "18x190 cm" or "19×160-190 cm"
    const dimMatch = trimmed.match(/(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*\d+)?\s*cm/i);
    if (dimMatch) {
      currentProduct.tileWidth = parseInt(dimMatch[1]);
      currentProduct.tileHeight = parseInt(dimMatch[2]);
    }

    // Match price like "15.950 kr/m2" or "16.950 kr/m²"
    const priceMatch = trimmed.match(/([\d.]+)\s*kr\s*\/\s*m[2²]/i);
    if (priceMatch) {
      const priceStr = priceMatch[1].replace(/\./g, '');
      const parsed = parseInt(priceStr);
      if (!isNaN(parsed) && parsed > 0) {
        currentProduct.price = parsed;
      }
    }
  }

  // Don't forget the last product
  if (currentProduct && currentProduct.name) {
    products.push(currentProduct);
  }

  // Also try to grab images from the page and match them to products
  const images = [];
  $('img').each((_, img) => {
    const src = $(img).attr('data-src') || $(img).attr('src') || '';
    const alt = $(img).attr('alt') || '';
    if (src && !src.includes('placeholder') && !src.includes('data:image') && !src.includes('logo') && !src.includes('icon')) {
      const fullSrc = src.startsWith('http') ? src : `https://vidd.is${src}`;
      images.push({ src: fullSrc, alt: alt.toLowerCase() });
    }
  });

  // Try to match images to products by name similarity
  for (const p of products) {
    const nameLower = p.name.toLowerCase();
    const words = nameLower.split(/\s+/);
    for (const img of images) {
      if (words.some(w => w.length > 3 && img.alt.includes(w))) {
        p.imageUrl = img.src;
        break;
      }
      if (words.some(w => w.length > 3 && img.src.toLowerCase().includes(w))) {
        p.imageUrl = img.src;
        break;
      }
    }
  }

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

    // Try to get price from detail page
    let price = null;

    // 1. Standard WooCommerce price
    const priceEl = $('.price .woocommerce-Price-amount, .product-price, ins .woocommerce-Price-amount').first();
    if (priceEl.length) {
      const priceText = priceEl.text().replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(priceText);
      if (!isNaN(parsed) && parsed > 0) price = parsed;
    }

    // 2. Try data-variations JSON (vidd.is custom pricing)
    if (!price) {
      const configEl = $('[data-variations]');
      if (configEl.length) {
        try {
          const variations = JSON.parse(configEl.attr('data-variations'));
          if (Array.isArray(variations) && variations.length > 0) {
            const firstPrice = variations[0]?.price_per_sqm || variations[0]?.display_price;
            if (firstPrice && !isNaN(parseFloat(firstPrice))) {
              price = parseFloat(firstPrice);
            }
          }
        } catch { /* ignore parse errors */ }
      }
    }

    // 3. Try finding "kr" in specific price-related elements
    if (!price) {
      const krMatch = fullText.match(/(\d[\d.]*)\s*kr\s*\/?\s*m[2²]?/i);
      if (krMatch) {
        const priceStr = krMatch[1].replace(/\./g, '');
        const parsed = parseInt(priceStr);
        if (!isNaN(parsed) && parsed > 100 && parsed < 10000000) {
          price = parsed;
        }
      }
    }

    // Check for sale/discount indicators
    let originalPrice = null;
    const delPrice = $('del .woocommerce-Price-amount, .price del').first();
    if (delPrice.length) {
      const delText = delPrice.text().replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
      const parsed = parseFloat(delText);
      if (!isNaN(parsed) && parsed > 0) originalPrice = parsed;
    }

    // Check for sale badge
    let onSale = false;
    if ($('.onsale, .vidd-bf-badge-30, .vidd-bf-badge-50, .vidd-bf-badge-70, [class*="sale"], [class*="tilbod"]').length) {
      onSale = true;
    }

    return { imageUrl, description, tileWidth, tileHeight, price, originalPrice, onSale };
  } catch (err) {
    console.warn(`  ⚠ Could not fetch details for ${url}: ${err.message}`);
    return { imageUrl: null, description: null, tileWidth: null, tileHeight: null, price: null, originalPrice: null, onSale: false };
  }
}

async function main() {
  console.log('🏪 Vídd Product Scraper v2');
  console.log('===========================\n');

  // Find Vídd company
  const company = await prisma.company.findUnique({ where: { slug: 'vdd' } });
  if (!company) {
    console.error('❌ Company "vdd" not found. Create it first in super admin.');
    process.exit(1);
  }
  console.log(`✅ Found company: ${company.name} (${company.id})\n`);

  // Collect all products from all category pages
  // Key change: track by sourceUrl, LAST category wins (more specific)
  const productsByUrl = new Map(); // sourceUrl → product data
  const categoryMap = {};

  for (const cat of CATEGORY_PAGES) {
    console.log(`📂 Scraping: ${cat.category} — ${cat.url}`);
    try {
      const html = await fetchPage(cat.url);
      const isParket = cat.url.includes('/parket/');
      const products = isParket
        ? extractParketProducts(html)
        : extractProducts(html, cat.url);

      console.log(`   Found ${products.length} products on listing page`);

      // Fetch details for each product (skip for parket — no detail pages)
      for (let i = 0; i < products.length; i++) {
        const p = products[i];

        if (!isParket) {
          process.stdout.write(`   Fetching details ${i + 1}/${products.length}: ${p.name.slice(0, 40)}...`);

          const details = await fetchProductDetails(p.sourceUrl);

          // Use higher-res image from detail page if available
          if (details.imageUrl) p.imageUrl = details.imageUrl;
          p.description = details.description;
          if (!p.tileWidth) p.tileWidth = details.tileWidth;
          if (!p.tileHeight) p.tileHeight = details.tileHeight;
          if (details.price && !p.price) p.price = details.price;
          if (details.originalPrice) p.originalPrice = details.originalPrice;
          if (details.onSale) p.onSale = true;

          console.log(` ✓`);

          // Small delay to be nice
          await new Promise(r => setTimeout(r, 300));
        }

        // Assign category — LAST category wins for shared products
        p.category = cat.category;
        p.surfaceType = cat.surfaceType;

        // Store by URL — overwrites earlier category assignment
        productsByUrl.set(p.sourceUrl, p);
      }

      categoryMap[cat.category] = cat.surfaceType;
    } catch (err) {
      console.error(`   ❌ Error scraping ${cat.url}: ${err.message}`);
    }
    console.log('');
  }

  // Convert map to array — each product now has its most specific category
  const uniqueProducts = [...productsByUrl.values()];

  // Count products per category
  const catCounts = {};
  for (const p of uniqueProducts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }

  console.log(`\n📊 Total unique products: ${uniqueProducts.length}`);
  console.log('   Per category:');
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`     ${cat}: ${count}`);
  }

  // Check for categories with 0 products
  for (const catName of Object.keys(categoryMap)) {
    if (!catCounts[catName]) {
      console.warn(`   ⚠ ${catName}: 0 (all products were reassigned to more specific categories)`);
    }
  }

  const withPrices = uniqueProducts.filter(p => p.price).length;
  const withSale = uniqueProducts.filter(p => p.onSale || p.originalPrice).length;
  console.log(`\n   💰 Products with prices: ${withPrices}`);
  console.log(`   🏷️  Products on sale: ${withSale}\n`);

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

  // Create categories (only those that have products)
  console.log('\n📁 Creating categories...');
  const catIds = {};
  let catSort = 1;
  for (const [catName, surfaceType] of Object.entries(categoryMap)) {
    // Only create if at least 1 product OR it's a known category
    const cat = await prisma.category.create({
      data: {
        companyId: company.id,
        name: catName,
        surfaceType,
        sortOrder: catSort++,
      },
    });
    catIds[catName] = cat.id;
    const count = catCounts[catName] || 0;
    console.log(`   ✅ ${catName} (${count} products)`);
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

      // Build description with price/sale info
      let description = p.description || null;
      if (p.onSale && !description) {
        description = 'Á tilboði';
      }

      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          description,
          price: p.price,
          unit: 'm2',
          imageUrl,
          swatchUrl: p.imageUrl || null,  // Same as imageUrl (source doesn't distinguish swatch vs room)
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
