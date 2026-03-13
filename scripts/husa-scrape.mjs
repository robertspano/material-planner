#!/usr/bin/env node
/**
 * Húsasmiðjan Product Scraper v3
 * Fetches products from husa.is via their webapi/catalog API
 * Uses PARENT category IDs to get ALL products (subcategories included)
 * Then auto-detects subcategory from product URL path
 * Includes deduplication of same material in different sizes
 */

import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();
const COMPANY_SLUG = "husasmidjan";
const BASE_URL = "https://www.husa.is";
const API_BASE = `${BASE_URL}/webapi/catalog/products/Husasmidjan`;
const PAGE_SIZE = 200;

// Use PARENT category IDs to get ALL products including subcategories
const FETCH_CATEGORIES = [
  { id: "b773b06e-0b70-4fc9-a155-12019de622bb", name: "Parket",              surface: "floor" },
  { id: "c3c4685f-eaee-4119-b574-24469710d67f", name: "Flísar",              surface: "floor" },
  { id: "1f4ecb2e-6a8d-4b4a-999d-e443d17d0116", name: "Lofta og veggjaefni", surface: "wall"  },
  { id: "66bb8a87-8a6f-4dee-8ed6-dd6947abf3c1", name: "Panilklæðningar",     surface: "wall"  },
  { id: "a41bfc7a-3162-4b22-8d15-0df6fa3c4312", name: "Vatnsklæðningar",     surface: "wall"  },
];

// Map URL path segments to specific subcategory names
const SUBCATEGORY_MAP = {
  // Parket subcategories
  "vidarparket":    { name: "Viðarparket",          surface: "floor" },
  "hardparket":     { name: "Harðparket",            surface: "floor" },
  "vinyl-parket":   { name: "Vinyl parket",          surface: "floor" },
  // Flísar subcategories
  "golf-og-veggflisar": { name: "Gólf- og veggflísar", surface: "floor" },
  "mosaik-flisar":      { name: "Mósaík flísar",        surface: "floor" },
  // Lofta og veggjaefni subcategories (only wall materials)
  "lofta-og-veggjathiljur": { name: "Veggjaþiljur",           surface: "wall" },
  "badplotur":              { name: "Baðplötur",               surface: "wall" },
  // Timbur/klæðning
  "panilklaedningar":       { name: "Panilklæðningar",         surface: "wall" },
  "vatnsklaedningar":       { name: "Vatnsklæðningar",         surface: "wall" },
};

// Categories to SKIP entirely (not surface materials or not suitable for planner)
const SKIP_CATEGORIES = [
  "Stiklur",             // trim/edge pieces, not surface materials
  "Hljóðvistarplötur",   // acoustic comfort panels
  "Eldhúsplötur",        // kitchen countertops
  "Frágangslistar",      // finishing strips
  "Klemmur",             // clamps/fasteners
  "Harðviðarklæðningar", // hardwood cladding (if not relevant)
];

/** Detect subcategory from product URL */
function detectSubcategory(productUrl, parentCat) {
  if (!productUrl) return { name: parentCat.name, surface: parentCat.surface };
  const parts = productUrl.split("/").filter(Boolean);
  for (let i = parts.length - 2; i >= 0; i--) {
    const sub = SUBCATEGORY_MAP[parts[i]];
    if (sub) return sub;
  }
  return { name: parentCat.name, surface: parentCat.surface };
}

/**
 * Deduplicate products that are the same material in different sizes/lengths.
 * Groups by normalized base name and keeps one per group.
 */
function deduplicateSizes(products) {
  const groups = {};
  for (const p of products) {
    let base = p.name
      .replace(/\s+\d+[.,]\d+(\s+PEFC\s+\d+%)?$/i, "")   // trailing size "3.6 PEFC 70%"
      .replace(/\s+MM\*?$/i, "")                           // trailing "MM" or "MM*"
      .replace(/\s*\(\d+\).*$/i, "")                       // "(522700)" style codes
      .replace(/\s*(rect\.?|rett\.?)\s*/gi, " ")           // tile "rect" / "rett"
      .replace(/\d+\s*x\s*\d+(\s*cm)?/gi, "")             // dimensions like "30x60 cm"
      .replace(/\d+\/[\d.,]+\/[\d.,]+/g, "")               // "7/1,26/50,4" tile pack specs
      .replace(/reol\s*\d*/gi, "")                         // "reol 91"
      .replace(/matt/gi, "").replace(/glans/gi, "")        // surface finish modifiers
      .replace(/\s+/g, " ")
      .trim();

    if (!groups[base]) groups[base] = [];
    groups[base].push(p);
  }

  const deduped = [];
  for (const [, items] of Object.entries(groups)) {
    if (items.length === 1) {
      deduped.push(items[0]);
      continue;
    }
    // Keep the one with a real price (>1000), prefer middle item
    const withPrice = items.filter(p => p.price > 1000);
    const candidates = withPrice.length > 0 ? withPrice : items;
    deduped.push(candidates[Math.floor(candidates.length / 2)]);
  }

  return deduped;
}

/** Fetch all products from a category (handles pagination) */
async function fetchCategory(cat) {
  const allProducts = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${API_BASE}/${cat.id}/${page}/${PAGE_SIZE}`;
    console.log(`  📦 ${cat.name} — page ${page}/${totalPages}...`);

    const res = await fetch(url, {
      headers: {
        "storeAlias": "Husasmidjan",
        "Accept-Language": "is-IS",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SnidScraper/1.0",
      },
    });

    if (!res.ok) {
      console.error(`    ❌ HTTP ${res.status} for ${cat.name} page ${page}`);
      break;
    }

    const data = await res.json();
    totalPages = data.PageCount || 1;
    const totalCount = data.TotalProductCount || data.ProductCount || 0;
    if (page === 1) console.log(`   (API says ${data.ProductCount} products, ${totalCount} total)`);

    const products = data.Products || [];
    for (const p of products) {
      const title = p.Title || p.Description || "";
      const slug = p.Slug || p.Url?.split("/").filter(Boolean).pop() || "";
      const productUrl = p.Url || "";

      // Detect subcategory from URL
      const subcat = detectSubcategory(productUrl, cat);

      // Skip excluded categories
      if (SKIP_CATEGORIES.includes(subcat.name)) continue;

      // Image URL
      let imageUrl = p.ImageUrl || "";
      if (!imageUrl && p.SupportingImages?.length) {
        imageUrl = p.SupportingImages[0];
      }
      if (!imageUrl && p.Images?.length) {
        imageUrl = typeof p.Images[0] === "string" ? p.Images[0] : p.Images[0]?.Url || "";
      }
      if (imageUrl) {
        imageUrl = imageUrl.replace(/\?$/, "");
        if (!imageUrl.startsWith("http")) {
          imageUrl = `${BASE_URL}${imageUrl}`;
        }
        if (!imageUrl.includes("?")) {
          imageUrl += "?width=800&format=webp";
        }
      }

      // Price
      const price = p.Price?.Value || p.Price?.OriginalValue || null;
      const onSale = p.OnSale || p.Price?.HasDiscount || false;
      const oldPrice = onSale ? (p.OldPrice || p.Price?.BeforeDiscount?.Value || null) : null;

      if (!title && !slug) continue;

      // Skip products that are clearly not surface materials
      const nameLower = (title || slug).toLowerCase();
      if (nameLower.includes("músaband") || nameLower.includes("lím") || nameLower.includes("festingar")) continue;
      // Skip ceiling-only products
      if (nameLower.startsWith("loftaklæðning")) continue;

      allProducts.push({
        name: title || slug,
        sourceUrl: productUrl ? `${BASE_URL}${productUrl}` : "",
        imageUrl,
        price,
        onSale,
        oldPrice,
        categoryName: subcat.name,
        surfaceType: subcat.surface,
        brand: p.Brand || null,
      });
    }

    page++;
    await new Promise(r => setTimeout(r, 300));
  }

  return allProducts;
}

/** Main scraper */
async function main() {
  console.log("🏠 Húsasmiðjan Product Scraper v3\n");

  // 1. Find company
  const company = await prisma.company.findUnique({ where: { slug: COMPANY_SLUG } });
  if (!company) {
    console.error(`❌ Company with slug "${COMPANY_SLUG}" not found`);
    process.exit(1);
  }
  console.log(`✅ Company: ${company.name} (${company.id})\n`);

  // 2. Fetch from all parent categories
  const allProducts = [];
  for (const cat of FETCH_CATEGORIES) {
    console.log(`\n📂 ${cat.name}`);
    const products = await fetchCategory(cat);
    console.log(`   → ${products.length} products fetched`);
    allProducts.push(...products);
  }

  // 3. Deduplicate by sourceUrl (keep last occurrence)
  const productMap = new Map();
  for (const p of allProducts) {
    productMap.set(p.sourceUrl, p);
  }
  let uniqueProducts = [...productMap.values()];
  console.log(`\n📊 After URL dedup: ${uniqueProducts.length} (from ${allProducts.length} raw)`);

  // 4. Remove products without images
  uniqueProducts = uniqueProducts.filter(p => p.imageUrl);
  console.log(`📊 After removing no-image: ${uniqueProducts.length}`);

  // 5. Deduplicate same material in different sizes per category
  const byCategory = {};
  for (const p of uniqueProducts) {
    if (!byCategory[p.categoryName]) byCategory[p.categoryName] = [];
    byCategory[p.categoryName].push(p);
  }

  uniqueProducts = [];
  for (const [catName, products] of Object.entries(byCategory)) {
    const before = products.length;
    const deduped = deduplicateSizes(products);
    if (deduped.length < before) {
      console.log(`   🔄 ${catName}: ${before} → ${deduped.length} (removed ${before - deduped.length} size duplicates)`);
    }
    uniqueProducts.push(...deduped);
  }
  console.log(`📊 After size dedup: ${uniqueProducts.length}\n`);

  // 6. Ensure categories exist in DB
  const categoryNames = [...new Set(uniqueProducts.map(p => p.categoryName))];
  const existingCats = await prisma.category.findMany({
    where: { companyId: company.id },
  });
  const catByName = new Map(existingCats.map(c => [c.name, c]));

  for (const name of categoryNames) {
    if (!catByName.has(name)) {
      const sampleProduct = uniqueProducts.find(p => p.categoryName === name);
      const surfaceType = sampleProduct?.surfaceType || "floor";

      const created = await prisma.category.create({
        data: { name, companyId: company.id, surfaceType },
      });
      catByName.set(name, created);
      console.log(`  🆕 Created category: ${name} (${surfaceType})`);
    }
  }

  // 7. Clear existing products
  const deleted = await prisma.product.deleteMany({
    where: { companyId: company.id },
  });
  console.log(`\n🗑️  Cleared ${deleted.count} existing products\n`);

  // 8. Insert products
  let inserted = 0;
  let failed = 0;
  for (const p of uniqueProducts) {
    const cat = catByName.get(p.categoryName);
    if (!cat) {
      console.error(`  ⚠️  No category for: ${p.name}`);
      failed++;
      continue;
    }

    const surfaceTypes = p.surfaceType === "wall" ? ["wall"] : ["floor"];

    try {
      await prisma.product.create({
        data: {
          name: p.name,
          companyId: company.id,
          categoryId: cat.id,
          imageUrl: p.imageUrl,
          swatchUrl: p.imageUrl || null,  // Same as imageUrl (source doesn't distinguish swatch vs room)
          price: p.price,
          surfaceTypes,
          discountPercent: p.onSale && p.oldPrice && p.price
            ? Math.round((1 - p.price / p.oldPrice) * 100)
            : null,
        },
      });
      inserted++;
    } catch (err) {
      console.error(`  ❌ Failed: ${p.name} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅ Done!`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Failed:   ${failed}`);
  console.log(`   Categories: ${categoryNames.length}`);

  // Print breakdown
  const groupCounts = {};
  for (const p of uniqueProducts) {
    groupCounts[p.categoryName] = (groupCounts[p.categoryName] || 0) + 1;
  }
  console.log("\n📋 Breakdown:");
  for (const [key, count] of Object.entries(groupCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${key}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Fatal:", err);
  prisma.$disconnect();
  process.exit(1);
});
