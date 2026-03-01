#!/usr/bin/env node

/**
 * Alfaborg Gallery Image Scraper (v2 — picks best landscape image)
 *
 * Scrapes the "MYNDIR" (room scene / installed look) images from each
 * Alfaborg product page. For each product, checks all gallery images
 * and picks the best landscape-oriented one (best for the 4:3 hover popup).
 *
 * Image dimension detection: reads the first ~10KB of each JPEG to extract
 * width/height from the SOF marker without downloading the full image.
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

const DELAY_MS = 300;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        if (attempt === 0) { await sleep(2000); continue; }
        return null;
      }
      return await res.text();
    } catch {
      if (attempt === 0) { await sleep(2000); continue; }
      return null;
    }
  }
  return null;
}

/**
 * Read JPEG dimensions from the first ~16KB of image data.
 * Returns { width, height } or null.
 */
function readJpegDimensions(buffer) {
  if (buffer.length < 4) return null;
  // Verify JPEG magic bytes
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;

  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xFF) { offset++; continue; }

    const marker = buffer[offset + 1];

    // SOF markers (Start of Frame) contain dimensions
    // SOF0=0xC0, SOF1=0xC1, SOF2=0xC2, SOF3=0xC3
    if (marker >= 0xC0 && marker <= 0xC3) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) {
        return { width, height };
      }
    }

    // Skip to next marker
    if (marker === 0xD8 || marker === 0xD9) {
      offset += 2;
    } else {
      const segLen = buffer.readUInt16BE(offset + 2);
      offset += 2 + segLen;
    }
  }
  return null;
}

/**
 * Fetch just the first 16KB of an image to read its dimensions.
 */
async function getImageDimensions(url) {
  try {
    const res = await fetch(url, {
      headers: {
        ...HEADERS,
        'Range': 'bytes=0-16383',
        'Accept': 'image/*',
      },
    });
    if (!res.ok && res.status !== 206) return null;

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return readJpegDimensions(buffer);
  } catch {
    return null;
  }
}

/**
 * Extract gallery image URLs from the HTML (base64-encoded JSON).
 */
function extractGalleryImages(html) {
  const galleryIdx = html.indexOf('my-gallery');
  if (galleryIdx === -1) return [];

  const searchStart = Math.max(0, galleryIdx - 5000);
  const section = html.substring(searchStart, galleryIdx + 200);

  const b64Pattern = /[A-Za-z0-9+/]{50,}={0,2}/g;
  let match;
  while ((match = b64Pattern.exec(section)) !== null) {
    try {
      const decoded = Buffer.from(match[0], 'base64').toString('utf-8');
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
 * Pick the best gallery image for the hover popup.
 * Prefers landscape images with the widest aspect ratio.
 * Falls back to the largest image if no landscape found.
 */
async function pickBestImage(images) {
  if (images.length === 0) return null;
  if (images.length === 1) return images[0].url;

  // Check dimensions for each image (fetch only first 16KB)
  const candidates = [];
  for (const img of images) {
    const dims = await getImageDimensions(img.url);
    candidates.push({
      url: img.url,
      description: img.description,
      width: dims?.width || 0,
      height: dims?.height || 0,
      isLandscape: dims ? dims.width >= dims.height : false,
      aspectRatio: dims && dims.height > 0 ? dims.width / dims.height : 0,
      area: dims ? dims.width * dims.height : 0,
    });
  }

  // Prefer landscape images
  const landscape = candidates.filter(c => c.isLandscape && c.width >= 800);
  if (landscape.length > 0) {
    // Among landscape images, prefer the one closest to 4:3 ratio (1.33) but wider than 1:1
    // Sort by: closest to 4:3, then by resolution
    landscape.sort((a, b) => {
      const targetRatio = 4 / 3;
      const diffA = Math.abs(a.aspectRatio - targetRatio);
      const diffB = Math.abs(b.aspectRatio - targetRatio);
      // If one is much closer to target ratio, prefer it
      if (Math.abs(diffA - diffB) > 0.3) return diffA - diffB;
      // Otherwise prefer higher resolution
      return b.area - a.area;
    });
    return landscape[0].url;
  }

  // No landscape images — pick the one with most pixels
  candidates.sort((a, b) => b.area - a.area);
  // If we got dimensions, use the best. Otherwise just use the first image.
  return candidates[0].area > 0 ? candidates[0].url : images[0].url;
}

async function main() {
  console.log('=== Alfaborg Gallery Image Scraper v2 (best landscape) ===\n');

  const jsonPath = path.join(__dirname, 'alfaborg-products.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('ERROR: alfaborg-products.json not found');
    process.exit(1);
  }

  const rawProducts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Loaded ${rawProducts.length} products from JSON\n`);

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

  const dbMap = new Map();
  for (const p of dbProducts) {
    const key = `${p.name}|${p.description || ''}`.toLowerCase();
    dbMap.set(key, p);
  }

  // Deduplicate by href
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
  let landscapeCount = 0;

  const entries = [...uniqueHrefs.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [href, products] = entries[i];
    const url = `${BASE_URL}${href}`;
    const firstName = products[0].name;

    process.stdout.write(`  [${i + 1}/${entries.length}] ${firstName}... `);

    const html = await fetchPage(url);
    scraped++;

    if (!html) {
      console.log('FAILED');
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

    // Pick the best image (checking dimensions for landscape preference)
    const bestUrl = await pickBestImage(galleryImages);
    if (!bestUrl) {
      console.log('no good image');
      skipped++;
      await sleep(DELAY_MS);
      continue;
    }

    found++;

    // Check if it's landscape
    const dims = await getImageDimensions(bestUrl);
    const isLandscape = dims && dims.width >= dims.height;
    if (isLandscape) landscapeCount++;

    let updatedCount = 0;
    for (const rawProduct of products) {
      const key = `${rawProduct.name}|${rawProduct.description || ''}`.toLowerCase();
      const dbProduct = dbMap.get(key);

      if (dbProduct) {
        await prisma.product.update({
          where: { id: dbProduct.id },
          data: { swatchUrl: bestUrl },
        });
        updatedCount++;
        updated++;
      }
    }

    const dimStr = dims ? `${dims.width}x${dims.height}` : '?';
    const orientStr = isLandscape ? 'L' : 'P';
    console.log(`${galleryImages.length} imgs -> best: ${dimStr} [${orientStr}] -> ${updatedCount} updated`);
    await sleep(DELAY_MS);
  }

  console.log(`\n=== Scrape Complete ===`);
  console.log(`Pages scraped: ${scraped}`);
  console.log(`Gallery images found: ${found}`);
  console.log(`Products updated in DB: ${updated}`);
  console.log(`Landscape images picked: ${landscapeCount}`);
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
