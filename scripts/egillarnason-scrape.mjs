#!/usr/bin/env node
/**
 * Egill Árnason product scraper — scrapes flooring product images from
 * egillarnason.is (WordPress blog posts organized by category).
 *
 * This is a portfolio/showroom site — products are showcase images
 * without prices or dimensions.
 *
 * Usage: node scripts/egillarnason-scrape.mjs
 */
import { PrismaClient } from '../src/generated/prisma/index.js';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();
const BASE = 'https://www.egillarnason.is';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Category listing pages */
const CATEGORY_PAGES = [
  { url: '/parket',       category: 'Viðarparket',  surfaceType: 'floor' },
  { url: '/hardparket',   category: 'Harðparket',   surfaceType: 'floor' },
  { url: '/vinilparket',  category: 'Vínilparket',  surfaceType: 'floor' },
  { url: '/flisar',       category: 'Flísar',       surfaceType: 'both'  },
];

/** Fetch a page */
async function fetchPage(url) {
  const fullUrl = url.startsWith('http') ? url : `${BASE}${url}`;
  const res = await fetch(fullUrl, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${fullUrl}`);
  return res.text();
}

/** Extract products from a listing page */
function extractProducts(html) {
  const $ = cheerio.load(html);
  const products = [];

  $('article').each((_, el) => {
    const article = $(el);

    // Get product name from entry-title
    // Note: nested <a> tags cause cheerio to split them — use .text() on the h2
    // or .last() to skip the empty first <a>
    let name = article.find('.entry-title').first().text().trim();
    if (!name) name = article.find('h2').first().text().trim();
    if (!name) return;

    // Decode HTML entities
    name = name.replace(/&#8211;/g, '–').replace(/&#038;/g, '&').replace(/&#8217;/g, "'");

    // Get image URL from wp-post-image
    let imageUrl = null;
    const img = article.find('img.wp-post-image').first();
    if (img.length) {
      // Use the src attribute (already sized thumbnail)
      imageUrl = img.attr('src') || null;
      // Try to get a reasonable size from srcset
      const srcset = img.attr('srcset') || '';
      const srcsetParts = srcset.split(',').map(s => s.trim());
      // Find an ~800w version
      const medium = srcsetParts.find(s => s.includes('800w')) ||
                     srcsetParts.find(s => s.includes('1024w')) ||
                     srcsetParts.find(s => s.includes('768w'));
      if (medium) {
        const url = medium.split(' ')[0];
        if (url) imageUrl = url;
      }
    }

    // Get detail page URL
    const detailUrl = article.find('.entry-title a').attr('href') || article.find('a').first().attr('href') || '';

    if (imageUrl) {
      products.push({ name, imageUrl, detailUrl });
    }
  });

  return products;
}

/** Make names unique within a category by adding numbering for duplicates */
function makeNamesUnique(products) {
  // Count occurrences of each name
  const nameCounts = {};
  for (const p of products) {
    nameCounts[p.name] = (nameCounts[p.name] || 0) + 1;
  }

  // For names that appear more than once, add numbering
  const nameCounters = {};
  for (const p of products) {
    if (nameCounts[p.name] > 1) {
      nameCounters[p.name] = (nameCounters[p.name] || 0) + 1;
      p.name = `${p.name} ${nameCounters[p.name]}`;
    }
  }

  return products;
}

async function main() {
  console.log('🏪 Egill Árnason Product Scraper\n');

  // Find company
  const company = await prisma.company.findUnique({ where: { slug: 'egill-rnason' } });
  if (!company) {
    console.error('❌ Company "egill-rnason" not found in database');
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

  for (const cat of CATEGORY_PAGES) {
    console.log(`📂 Scraping ${cat.category} — ${cat.url}`);
    try {
      const html = await fetchPage(cat.url);
      let products = extractProducts(html);

      // Make names unique within category
      products = makeNamesUnique(products);

      console.log(`   Found ${products.length} products`);
      for (const p of products) {
        allProducts.push({
          ...p,
          category: cat.category,
          surfaceType: cat.surfaceType,
        });
      }
    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
    console.log('');
  }

  console.log(`📊 Total products: ${allProducts.length}`);

  // Count per category
  const catCounts = {};
  for (const p of allProducts) {
    catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  }
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`   ${cat}: ${count}`);
  }

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
        failed++;
        continue;
      }

      const surfaceTypes = p.surfaceType === 'both' ? ['floor', 'wall'] : [p.surfaceType || 'floor'];

      const imgUrl = p.imageUrl || '/placeholder-product.png';
      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          price: null,
          unit: 'm2',
          imageUrl: imgUrl,
          swatchUrl: p.imageUrl || null,  // Same as imageUrl (portfolio site — room photos only)
          surfaceTypes,
          sortOrder: sortOrder++,
        },
      });

      imported++;
      if (imported % 30 === 0) console.log(`   ${imported}/${allProducts.length} imported...`);
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
