#!/usr/bin/env node
/**
 * Egill Árnason product scraper — scrapes flooring product images from
 * egillarnason.is (WordPress blog posts organized by category).
 *
 * The site is a portfolio/showroom with mixed content:
 *   - Material close-up photos (texture, pattern, color)
 *   - Room/installation photos (how the flooring looks when laid)
 *
 * Multiple entries share the same product name (e.g., 4 "Kol" entries).
 * This scraper PAIRS them: one image becomes the material swatch (swatchUrl)
 * and the next becomes the room/installation photo (imageUrl).
 *
 * In the planner UI:
 *   - swatchUrl is shown by default (the material itself)
 *   - imageUrl is shown on hover (the material installed in a room)
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

/** Extract raw entries from a listing page */
function extractEntries(html) {
  const $ = cheerio.load(html);
  const entries = [];

  $('article').each((_, el) => {
    const article = $(el);

    // Get product name from entry-title
    let name = article.find('.entry-title').first().text().trim();
    if (!name) name = article.find('h2').first().text().trim();
    if (!name) return;

    // Decode HTML entities and normalize whitespace
    name = name
      .replace(/&#8211;/g, '–')
      .replace(/&#038;/g, '&')
      .replace(/&#8217;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Get image URL from wp-post-image
    let imageUrl = null;
    const img = article.find('img.wp-post-image').first();
    if (img.length) {
      imageUrl = img.attr('src') || null;
      // Try to get a reasonable size from srcset
      const srcset = img.attr('srcset') || '';
      const srcsetParts = srcset.split(',').map(s => s.trim());
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
      entries.push({ name, imageUrl, detailUrl });
    }
  });

  return entries;
}

/**
 * Group entries by product name, then pair them into products.
 *
 * Within each name group, consecutive entries are paired:
 *   - 1st entry → swatchUrl (material close-up)
 *   - 2nd entry → imageUrl (room/installation)
 *
 * This works because the site typically interleaves close-ups and room shots:
 *   - Close-up of the floor texture, then a room showing it installed
 *   - Or for tiles: close-up of the tile pattern, then a restaurant using it
 *
 * Groups with a single entry use the same image for both.
 * Groups with odd entries: last entry uses the same image for both.
 */
function pairIntoProducts(entries) {
  // Group by name
  const groups = {};
  for (const entry of entries) {
    if (!groups[entry.name]) groups[entry.name] = [];
    groups[entry.name].push(entry);
  }

  const products = [];

  for (const [baseName, groupEntries] of Object.entries(groups)) {
    if (groupEntries.length === 1) {
      // Single entry — same image for both
      products.push({
        name: baseName,
        swatchUrl: groupEntries[0].imageUrl,
        imageUrl: groupEntries[0].imageUrl,
      });
    } else {
      // Pair consecutive entries: [swatch, room], [swatch, room], ...
      let pairNum = 1;
      const totalPairs = Math.ceil(groupEntries.length / 2);
      for (let i = 0; i < groupEntries.length; i += 2) {
        const swatch = groupEntries[i];
        const room = groupEntries[i + 1] || swatch; // if odd, last uses same for both

        const name = totalPairs > 1
          ? `${baseName} ${pairNum}`
          : baseName;
        pairNum++;

        products.push({
          name,
          swatchUrl: swatch.imageUrl,  // Material/close-up image
          imageUrl: room.imageUrl,     // Room/installation image
        });
      }
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
      const rawEntries = extractEntries(html);
      console.log(`   Found ${rawEntries.length} entries on page`);

      // Pair entries into products (swatch + room)
      const products = pairIntoProducts(rawEntries);
      console.log(`   → ${products.length} products after pairing`);

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

      await prisma.product.create({
        data: {
          companyId: company.id,
          categoryId,
          name: p.name,
          price: null,
          unit: 'm2',
          imageUrl: p.imageUrl,      // Room/installation photo (shown on hover)
          swatchUrl: p.swatchUrl,    // Material close-up (shown by default)
          surfaceTypes,
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
