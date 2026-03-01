#!/usr/bin/env node

/**
 * Alfaborg Gallery Image Scraper
 *
 * Scrapes the "MYNDIR" (room scene / installed look) images from each
 * Alfaborg product page and stores the first gallery image URL as
 * `swatchUrl` in the database.
 *
 * The gallery images are embedded as base64-encoded JSON in the static HTML,
 * so no browser automation (puppeteer) is needed.
 *
 * Run: node scripts/scrape-gallery-images.mjs
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const BASE_URL = 'https://www.alfaborg.is';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'is,en;q=0.9',
};

const DELAY_MS = 400; // Polite delay between requests

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a page with browser-like headers. Retries once.
 */
async function fetchPage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        if (attempt === 0) { await sleep(2000); continue; }
        return null;
      }
      return await res.text();
    } catch (err) {
      if (attempt === 0) { await sleep(2000); continue; }
      return null;
    }
  }
  return null;
}

/**
 * Extract gallery image URLs from the HTML.
 *
 * The Alfaborg product page embeds gallery data as base64-encoded JSON
 * in a data attribute near the `.my-gallery` swiper container.
 *
 * Format: {"uniqueVal":"1","listOfImages":"[{\"url\":\"...\",\"description\":\"...\"}]"}
 */
function extractGalleryImages(html) {
  // Find the area around the gallery
  const galleryIdx = html.indexOf('my-gallery');
  if (galleryIdx === -1) return [];

  // Search for base64 strings in a large window before the gallery
  const searchStart = Math.max(0, galleryIdx - 5000);
  const section = html.substring(searchStart, galleryIdx + 200);

  // Find base64 strings (at least 50 chars, look like base64)
  const b64Pattern = /[A-Za-z0-9+/]{50,}={0,2}/g;
  let match;
  while ((match = b64Pattern.exec(section)) !== null) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf-8');
      // Check if this looks like our gallery data
      if (decoded.includes('listOfImages')) {
        const data = JSON.parse(decoded);
        if (data.listOfImages) {
          const images = JSON.parse(data.listOfImages);
          return images.map(img => ({
            url: img.url,
            description: img.description || '',
          }));
        }
      }
    } catch {
      // Not valid base64 JSON, skip
    }
  }

  return [];
}

/**
 * Also try to extract the main product image from background-image style
 */
function extractMainProductImage(html) {
  // The main product image is often a background-image on a specific div
  // Pattern: class containing "dmRespCol" + "large-7" with background-image
  const bgPattern = /u_1249815434[^>]*background-image:\s*url\(['"](https?:\/\/[^'"]+)['"]\)/;
  const match = html.match(bgPattern);
  if (match) return match[1];

  // Alternative: look for the main product image in a specific column
  const altPattern = /class="u_1249815434[^"]*"[^>]*style="[^"]*background-image:\s*url\(&quot;([^&]+)&quot;\)/;
  const altMatch = html.match(altPattern);
  if (altMatch) return altMatch[1];

  return null;
}

async function main() {
  console.log('=== Alfaborg Gallery Image Scraper ===\n');

  // Load the scraped products JSON (has href for each product)
  const jsonPath = path.join(__dirname, 'alfaborg-products.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('ERROR: alfaborg-products.json not found');
    process.exit(1);
  }

  const rawProducts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${rawProducts.length} products from JSON\n`);

  // Get all Alfaborg products from the database
  const company = await prisma.company.findUnique({ where: { slug: 'alfaborg' } });
  if (!company) {
    console.error('ERROR: Alfaborg company not found in database');
    process.exit(1);
  }

  const dbProducts = await prisma.product.findMany({
    where: { companyId: company.id },
    select: { id: true, name: true, description: true, swatchUrl: true },
  });
  console.log(`Found ${dbProducts.length} products in database\n`);

  // Build a lookup map: "name|description" -> dbProduct
  const dbMap = new Map();
  for (const p of dbProducts) {
    const key = `${p.name}|${p.description || ''}`.toLowerCase();
    dbMap.set(key, p);
  }

  // Deduplicate by href (some products share the same product page)
  const uniqueHrefs = new Map();
  for (const p of rawProducts) {
    if (!p.href) continue;
    if (!uniqueHrefs.has(p.href)) {
      uniqueHrefs.set(p.href, []);
    }
    uniqueHrefs.get(p.href).push(p);
  }

  console.log(`${uniqueHrefs.size} unique product pages to scrape\n`);

  let scraped = 0;
  let found = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  const entries = [...uniqueHrefs.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [href, products] = entries[i];
    const url = `${BASE_URL}${href}`;
    const firstName = products[0].name;

    process.stdout.write(`  [${i + 1}/${entries.length}] ${firstName}... `);

    const html = await fetchPage(url);
    scraped++;

    if (!html) {
      console.log('FAILED (fetch error)');
      failed++;
      await sleep(DELAY_MS);
      continue;
    }

    const galleryImages = extractGalleryImages(html);

    if (galleryImages.length === 0) {
      console.log('no gallery');
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    // Use the first gallery image (usually the best room scene)
    const galleryUrl = galleryImages[0].url;
    found++;

    // Update all DB products that match any of the raw products sharing this href
    let updatedCount = 0;
    for (const rawProduct of products) {
      const key = `${rawProduct.name}|${rawProduct.description || ''}`.toLowerCase();
      const dbProduct = dbMap.get(key);

      if (dbProduct) {
        await prisma.product.update({
          where: { id: dbProduct.id },
          data: { swatchUrl: galleryUrl },
        });
        updatedCount++;
        updated++;
      }
    }

    console.log(`${galleryImages.length} images -> updated ${updatedCount} products`);
    await sleep(DELAY_MS);
  }

  console.log(`\n=== Scrape Complete ===`);
  console.log(`Pages scraped: ${scraped}`);
  console.log(`Gallery images found: ${found}`);
  console.log(`Products updated in DB: ${updated}`);
  console.log(`Pages without gallery: ${skipped}`);
  console.log(`Pages failed: ${failed}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
