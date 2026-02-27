#!/usr/bin/env node

/**
 * Alfaborg Product Import Script
 *
 * Reads scraped product data from alfaborg-products.json,
 * downloads product images, and inserts everything into the database.
 *
 * Run: node scripts/alfaborg-import.mjs
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const COMPANY_SLUG = 'alfaborg';
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'uploads', 'alfaborg');

// Download an image from URL to local path
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    if (!url || url.length === 0) {
      resolve(false);
      return;
    }

    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Skip if already downloaded
    if (fs.existsSync(filepath)) {
      resolve(true);
      return;
    }

    const fetchUrl = url.startsWith('http') ? url : `https://www.alfaborg.is${url}`;

    const request = https.get(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Referer': 'https://www.alfaborg.is/'
      }
    }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        downloadImage(redirectUrl, filepath).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        resolve(false);
        return;
      }

      const file = fs.createWriteStream(filepath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
      file.on('error', (err) => {
        fs.unlink(filepath, () => {});
        resolve(false);
      });
    });

    request.on('error', () => resolve(false));
    request.setTimeout(15000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

// Generate a slug from product name + description
function makeSlug(name, desc) {
  const combined = `${name} ${desc}`.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
  return combined;
}

// Map scraped category names to DB categories
const CATEGORY_MAP = {
  // Tiles
  'Einlitar flísar': { name: 'Einlitar flísar', surfaceType: 'both', group: 'flisar' },
  'Náttúrusteinsútlit': { name: 'Náttúrusteinsútlit', surfaceType: 'both', group: 'flisar' },
  'Steypuútlit': { name: 'Steypuútlit', surfaceType: 'both', group: 'flisar' },
  'Marmaraútlit': { name: 'Marmaraútlit', surfaceType: 'both', group: 'flisar' },
  'Viðarútlit flísar': { name: 'Viðarútlit flísar', surfaceType: 'floor', group: 'flisar' },
  'Mynstur- og skrautflísar': { name: 'Mynstur- og skrautflísar', surfaceType: 'both', group: 'flisar' },
  'Terrazzoútlit': { name: 'Terrazzoútlit', surfaceType: 'both', group: 'flisar' },
  'Útiflísar': { name: 'Útiflísar', surfaceType: 'floor', group: 'flisar' },
  // Parket
  'Harðparket': { name: 'Harðparket', surfaceType: 'floor', group: 'parket' },
  'Viðarparket': { name: 'Viðarparket', surfaceType: 'floor', group: 'parket' },
  'Lauslimt parket': { name: 'Lauslimt parket', surfaceType: 'floor', group: 'parket' },
  'Vínylparket niðurlimt': { name: 'Vínylparket niðurlimt', surfaceType: 'floor', group: 'parket' },
  'Vínylparket lauslagt': { name: 'Vínylparket lauslagt', surfaceType: 'floor', group: 'parket' },
  'Vínylflisar smelltar': { name: 'Vínylflisar smelltar', surfaceType: 'floor', group: 'parket' },
  'Vínylflisar niðurlimdar': { name: 'Vínylflisar niðurlimdar', surfaceType: 'floor', group: 'parket' },
};

async function main() {
  console.log('=== Alfaborg Product Import ===\n');

  // Load scraped data
  const dataPath = path.join(__dirname, 'alfaborg-products.json');
  if (!fs.existsSync(dataPath)) {
    console.error('ERROR: alfaborg-products.json not found. Run the scraper first.');
    process.exit(1);
  }

  const rawProducts = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  console.log(`Loaded ${rawProducts.length} products from JSON\n`);

  // 1. Create or update Alfaborg company
  console.log('1. Creating Alfaborg company...');
  const company = await prisma.company.upsert({
    where: { slug: COMPANY_SLUG },
    update: { name: 'Álfaborg' },
    create: {
      name: 'Álfaborg',
      slug: COMPANY_SLUG,
      primaryColor: '#1a5276',
      secondaryColor: '#2c3e50',
      monthlyGenerationLimit: 1000,
    },
  });
  console.log(`   Company: ${company.name} (${company.id})\n`);

  // 2. Create admin for Alfaborg
  console.log('2. Creating Alfaborg admin...');
  const adminPassword = await bcrypt.hash('alfaborg123', 12);
  const admin = await prisma.companyAdmin.upsert({
    where: { email: 'admin@alfaborg.is' },
    update: {},
    create: {
      email: 'admin@alfaborg.is',
      passwordHash: adminPassword,
      name: 'Álfaborg Admin',
      role: 'admin',
      companyId: company.id,
    },
  });
  console.log(`   Admin: ${admin.email}\n`);

  // 3. Create categories
  console.log('3. Creating categories...');
  const categoryIds = {};
  let sortOrder = 1;

  for (const [key, catDef] of Object.entries(CATEGORY_MAP)) {
    const catId = `alfa-cat-${key.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}`;
    const category = await prisma.category.upsert({
      where: { id: catId },
      update: { name: catDef.name, surfaceType: catDef.surfaceType, sortOrder },
      create: {
        id: catId,
        companyId: company.id,
        name: catDef.name,
        surfaceType: catDef.surfaceType,
        sortOrder,
      },
    });
    categoryIds[key] = category.id;
    console.log(`   ${catDef.name}: ${category.id}`);
    sortOrder++;
  }
  console.log('');

  // 4. Download images and create products
  console.log('4. Downloading images and creating products...');

  // Ensure image directory exists
  if (!fs.existsSync(IMAGE_DIR)) {
    fs.mkdirSync(IMAGE_DIR, { recursive: true });
  }

  let created = 0;
  let skipped = 0;
  let imgDownloaded = 0;
  let imgFailed = 0;

  // Process in batches to avoid overwhelming the CDN
  const BATCH_SIZE = 10;

  for (let i = 0; i < rawProducts.length; i += BATCH_SIZE) {
    const batch = rawProducts.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (product, batchIdx) => {
      const idx = i + batchIdx;
      const categoryId = categoryIds[product.category];
      if (!categoryId) {
        skipped++;
        return;
      }

      // Generate unique product ID from name + description
      const slug = makeSlug(product.name, product.description);
      const productId = `alfa-${slug}-${idx}`;

      // Download image
      let localImageUrl = '/placeholder-product.jpg';
      if (product.imageUrl) {
        const ext = product.imageUrl.match(/\.(jpg|jpeg|png|webp|svg)/i);
        const imgFilename = `${slug}-${idx}.${ext ? ext[1] : 'jpg'}`;
        const imgPath = path.join(IMAGE_DIR, imgFilename);

        const downloaded = await downloadImage(product.imageUrl, imgPath);
        if (downloaded) {
          localImageUrl = `/uploads/alfaborg/${imgFilename}`;
          imgDownloaded++;
        } else {
          imgFailed++;
          // Use the CDN URL as fallback
          localImageUrl = product.imageUrl;
        }
      }

      // Determine surface types
      const surfaceTypes = product.surfaceType === 'both'
        ? ['floor', 'wall']
        : [product.surfaceType || 'floor'];

      try {
        await prisma.product.upsert({
          where: { id: productId },
          update: {
            name: product.name,
            description: product.description || null,
            imageUrl: localImageUrl,
            surfaceTypes,
          },
          create: {
            id: productId,
            companyId: company.id,
            categoryId,
            name: product.name,
            description: product.description || null,
            imageUrl: localImageUrl,
            surfaceTypes,
            sortOrder: idx,
          },
        });
        created++;
      } catch (err) {
        console.error(`   ERROR creating product ${product.name}: ${err.message}`);
        skipped++;
      }
    }));

    // Progress
    const progress = Math.min(100, Math.round(((i + BATCH_SIZE) / rawProducts.length) * 100));
    process.stdout.write(`\r   Progress: ${progress}% (${created} created, ${imgDownloaded} images downloaded)`);
  }

  console.log(`\n\n=== Import Complete ===`);
  console.log(`Products created: ${created}`);
  console.log(`Products skipped: ${skipped}`);
  console.log(`Images downloaded: ${imgDownloaded}`);
  console.log(`Images failed: ${imgFailed}`);
  console.log(`\nLogin: admin@alfaborg.is / alfaborg123`);
  console.log(`Planner URL: http://localhost:3000/?company=alfaborg`);
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
