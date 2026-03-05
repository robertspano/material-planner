#!/usr/bin/env node

/**
 * Ebson Product Import Script v2
 *
 * Fetches product data from Ebson's Contentful CMS,
 * uploads images to Cloudinary, and imports to database.
 * Uses vrumynd as swatchUrl (material close-up) and images[0] as imageUrl (room photo).
 * Excludes Blöndunartæki and Hurðir categories.
 *
 * Run: node scripts/ebson-import.mjs
 */

import { PrismaClient } from '../src/generated/prisma/index.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

// Contentful config
const SPACE_ID = 'p3zfkdn4q6yj';
const ACCESS_TOKEN = '8f5e862cdf781b1d6d0783b154c6a66eae7f34a84024ab166b6404d060fb9c13';
const CF_BASE = `https://cdn.contentful.com/spaces/${SPACE_ID}`;

// Cloudinary config
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dgrig52h7';
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const COMPANY_ID = 'cmmdncfk40000lb04z6l1yj8l';

// Categories to EXCLUDE
const EXCLUDED_CATEGORIES = ['Blöndunartæki', 'Hurðir og fylgihlutir'];

// Surface type mapping
const CATEGORY_SURFACE_MAP = {
  'Flísar': 'both',
  'Parket': 'floor',
  'Harðparket': 'floor',
  'Klæðningar': 'wall',
};

// Inference rules for unmapped products
const CATEGORY_INFERENCE_RULES = [
  { pattern: /Rex$/i, category: 'Flísar' },
  { pattern: /^(I |Les |La |Étolie|Matières|Matiéres|Planches|Prexious)/i, category: 'Flísar' },
  { pattern: /tech\/?/i, category: 'Flísar' },
  { pattern: /^(Walks|Pietra|Kavastone|B&W Marble|SFRIDO|Castle White|Gold|Extra Light)$/i, category: 'Flísar' },
  { pattern: /^(Tesori|Storie|Rilievi|Policroma|Metamorfosi|Matrice|Lapis|Euridice|Cromatica|Archeologie|Araldica)$/i, category: 'Flísar' },
  { pattern: /^IMPRESSIO/i, category: 'Flísar' },
  { pattern: /^(Eternity Long|Glorious XL|Glorius XL)$/i, category: 'Harðparket' },
  { pattern: /^(AMBER|BREEZE|COPPER|CORAL|DAWN|DUNE|DUSK|DUST|EARTH|FIORD|FIRN|FOAM|FUME|HEXAGON|LAVA|LIBRA|LIGHT|MIDNIGHT|MOSS|POLAR|SAND|SIENNA|SIERRA|SPICE|STEPPE|TABACO|TERRA|URBAN SOUL|BOG Oak|CHANTILY|COLUMBA|DECO2)$/i, category: 'Harðparket' },
  { pattern: /^(VERSAILLES|Oak Chaletino|FLOORS|Selection Oak|Chevron|Admonter)$/i, category: 'Parket' },
  { pattern: /^Oak$/i, category: 'Parket' },
  { pattern: /^(Accoustic|Elements)$/i, category: 'Klæðningar' },
];

// Fetch from Contentful API
async function cfFetch(path) {
  const url = `${CF_BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${ACCESS_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Contentful error: ${res.status} ${await res.text()}`);
  return res.json();
}

// Upload image to Cloudinary
async function uploadToCloudinary(imageUrl, publicId) {
  if (!API_KEY || !API_SECRET) return imageUrl;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const crypto = await import('crypto');
    const paramsToSign = `folder=ebson-products&public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');

    const formData = new URLSearchParams();
    formData.append('file', imageUrl);
    formData.append('public_id', publicId);
    formData.append('folder', 'ebson-products');
    formData.append('timestamp', timestamp.toString());
    formData.append('api_key', API_KEY);
    formData.append('signature', signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) return imageUrl;
    const data = await res.json();
    return data.secure_url;
  } catch {
    return imageUrl;
  }
}

function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.,]/g, '');
  const num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
  return isNaN(num) ? null : num;
}

function parseDimensions(sizeStr) {
  if (!sizeStr) return {};
  const match = sizeStr.trim().match(/(\d+)\s*[*xX×]\s*(\d+)/);
  if (!match) return {};
  return { tileWidth: parseInt(match[1]), tileHeight: parseInt(match[2]) };
}

function makeSlug(str) {
  return str.toLowerCase()
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u').replace(/[ýỳ]/g, 'y')
    .replace(/[ðþ]/g, 'd').replace(/æ/g, 'ae')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
}

function inferCategory(name) {
  const trimmed = name.trim();
  for (const rule of CATEGORY_INFERENCE_RULES) {
    if (rule.pattern.test(trimmed)) return rule.category;
  }
  return null;
}

async function main() {
  console.log('=== Ebson Product Import v2 ===\n');

  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID } });
  if (!company) { console.error(`Company not found`); process.exit(1); }
  console.log(`Company: ${company.name} (${company.slug})\n`);

  // 1. Fetch all data from Contentful
  console.log('1. Fetching data from Contentful...');

  const categoriesDeepRes = await cfFetch('/entries?content_type=vrur&include=10&limit=100');
  const cfCategories = categoriesDeepRes.items
    .filter(i => i.fields)
    .filter(i => !EXCLUDED_CATEGORIES.includes(i.fields.nafn));
  console.log(`   Categories (excluding ${EXCLUDED_CATEGORIES.join(', ')}): ${cfCategories.length}`);

  const entryMap = {};
  for (const entry of (categoriesDeepRes.includes?.Entry || [])) {
    entryMap[entry.sys.id] = entry;
  }

  // Build product -> category mapping
  const productCategoryMap = {};
  for (const cat of cfCategories) {
    const catName = cat.fields.nafn;
    for (const brandRef of (cat.fields.vrumerki || [])) {
      const brand = entryMap[brandRef.sys.id];
      if (!brand) continue;
      const brandType = brand.sys.contentType.sys.id;
      if (brandType === 'lnur') {
        productCategoryMap[brand.sys.id] = catName;
      } else {
        for (const prodRef of (brand.fields.linur || [])) {
          productCategoryMap[prodRef.sys.id] = catName;
        }
      }
    }
  }
  console.log(`   Mapped via tree: ${Object.keys(productCategoryMap).length}`);

  // Fetch ALL product lines with resolved assets
  let allProducts = [];
  let globalAssets = {};
  let skip = 0;
  while (true) {
    const res = await cfFetch(`/entries?content_type=lnur&include=1&limit=100&skip=${skip}`);
    allProducts.push(...res.items.filter(i => i.fields));
    for (const asset of (res.includes?.Asset || [])) {
      globalAssets[asset.sys.id] = asset;
    }
    if (allProducts.length >= res.total) break;
    skip += 100;
  }
  console.log(`   Product lines: ${allProducts.length}`);
  console.log(`   Assets: ${Object.keys(globalAssets).length}`);

  // Apply inference rules for unmapped products (excluding excluded categories)
  let inferred = 0;
  for (const product of allProducts) {
    if (productCategoryMap[product.sys.id]) continue;
    const name = product.fields.nafnALinu || product.fields.title || '';
    const inferredCat = inferCategory(name);
    if (inferredCat && !EXCLUDED_CATEGORIES.includes(inferredCat)) {
      productCategoryMap[product.sys.id] = inferredCat;
      inferred++;
    }
  }
  console.log(`   Inferred: ${inferred} additional`);
  console.log(`   Total mapped: ${Object.keys(productCategoryMap).length}\n`);

  // 2. Clean existing Ebson data
  console.log('2. Cleaning existing Ebson products and categories...');
  const dp = await prisma.product.deleteMany({ where: { companyId: COMPANY_ID } });
  console.log(`   Deleted ${dp.count} products`);
  const dc = await prisma.category.deleteMany({ where: { companyId: COMPANY_ID } });
  console.log(`   Deleted ${dc.count} categories\n`);

  // 3. Create categories
  console.log('3. Creating categories...');
  const categoryIds = {};
  let sortOrder = 1;
  for (const cat of cfCategories) {
    const catName = cat.fields.nafn;
    const surfaceType = CATEGORY_SURFACE_MAP[catName] || 'both';
    const category = await prisma.category.create({
      data: { companyId: COMPANY_ID, name: catName, surfaceType, sortOrder: cat.fields.order || sortOrder },
    });
    categoryIds[catName] = category.id;
    console.log(`   ${catName} (${surfaceType}): ${category.id}`);
    sortOrder++;
  }
  console.log('');

  // 4. Import products
  console.log('4. Importing products...\n');

  let created = 0, skipped = 0, swatchesUploaded = 0, roomImagesUploaded = 0;

  for (let i = 0; i < allProducts.length; i++) {
    const product = allProducts[i];
    const fields = product.fields;
    const productName = (fields.nafnALinu || fields.title || '').trim();

    if (!productName || productName === 'Nafn á línu') { skipped++; continue; }

    const categoryName = productCategoryMap[product.sys.id];
    if (!categoryName || !categoryIds[categoryName]) { skipped++; continue; }

    const categoryId = categoryIds[categoryName];
    const surfaceType = CATEGORY_SURFACE_MAP[categoryName] || 'both';
    const surfaceTypes = surfaceType === 'both' ? ['floor', 'wall'] : [surfaceType];
    const slug = makeSlug(productName);

    // --- Room photo (imageUrl) from images[0] ---
    let imageUrl = '/placeholder-product.jpg';
    const imageRefs = fields.images || [];
    if (imageRefs.length > 0) {
      const asset = globalAssets[imageRefs[0].sys.id];
      if (asset?.fields?.file) {
        const cfUrl = `https:${asset.fields.file.url}`;
        imageUrl = await uploadToCloudinary(cfUrl, `room-${slug}-${i}`);
        roomImagesUploaded++;
      }
    }

    // --- Material swatch (swatchUrl) from vrumynd ---
    let swatchUrl = null;
    const vrumynd = fields.vrumynd;
    if (vrumynd) {
      const asset = globalAssets[vrumynd.sys.id];
      if (asset?.fields?.file) {
        const cfUrl = `https:${asset.fields.file.url}`;
        swatchUrl = await uploadToCloudinary(cfUrl, `swatch-${slug}-${i}`);
        swatchesUploaded++;
      }
    }

    // Parse price and dimensions
    const price = parsePrice(fields.price);
    const sizes = fields.strir || [];
    const dims = sizes.length > 0 ? parseDimensions(sizes[0]) : {};

    // Build description
    const parts = [];
    if (fields.litir?.length > 0) parts.push(`Litir: ${fields.litir.join(', ')}`);
    if (sizes.length > 0) parts.push(`Stærðir: ${sizes.join(', ')}`);
    if (fields.fer?.length > 0) parts.push(`Áferð: ${fields.fer.join(', ')}`);
    const description = parts.length > 0 ? parts.join(' | ') : null;

    try {
      await prisma.product.create({
        data: {
          companyId: COMPANY_ID,
          categoryId,
          name: productName,
          description,
          price,
          unit: 'm2',
          imageUrl,
          swatchUrl,
          surfaceTypes,
          sortOrder: i,
          tileWidth: dims.tileWidth || null,
          tileHeight: dims.tileHeight || null,
          isActive: true,
        },
      });
      created++;
      if (created % 10 === 0) {
        process.stdout.write(`\r   Progress: ${created} created, ${swatchesUploaded} swatches, ${roomImagesUploaded} room images`);
      }
    } catch (err) {
      console.error(`\n   ERROR: "${productName}": ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n\n=== Import Complete ===`);
  console.log(`Products created: ${created}`);
  console.log(`Products skipped: ${skipped}`);
  console.log(`Swatch images uploaded: ${swatchesUploaded}`);
  console.log(`Room images uploaded: ${roomImagesUploaded}`);
  console.log(`\nCategories:`);
  for (const [name, id] of Object.entries(categoryIds)) {
    const count = await prisma.product.count({ where: { categoryId: id } });
    const swatchCount = await prisma.product.count({ where: { categoryId: id, swatchUrl: { not: null } } });
    console.log(`   ${name}: ${count} products (${swatchCount} with swatch)`);
  }
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
