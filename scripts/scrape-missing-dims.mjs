/**
 * Generates a JSON file mapping product names to their alfaborg.is URLs
 * for the 129 products missing dimensions.
 *
 * Output: scripts/missing-dims-urls.json
 *
 * Run: node scripts/scrape-missing-dims.mjs
 */

import { PrismaClient } from "../src/generated/prisma/index.js";
import { readFileSync } from "fs";
import { writeFileSync } from "fs";

const prisma = new PrismaClient();

function makeSlug(name, desc) {
  const combined = `${name} ${desc}`.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 60);
  return combined;
}

async function main() {
  // Load JSON with hrefs
  const jsonProducts = JSON.parse(readFileSync("scripts/alfaborg-products.json", "utf-8"));

  // Build a lookup: slug -> { href, name, description }
  const slugToHref = new Map();
  jsonProducts.forEach((p, idx) => {
    const slug = makeSlug(p.name, p.description || "");
    slugToHref.set(slug, { href: p.href, name: p.name, description: p.description });
    // Also try just the name for fuzzy matching
  });

  // Get products without dimensions
  const missing = await prisma.product.findMany({
    where: { tileWidth: null },
    select: { id: true, name: true, description: true },
  });

  console.log(`Products without dimensions: ${missing.length}`);

  const urlList = [];
  const noMatch = [];

  for (const product of missing) {
    // Try to find matching JSON entry by name + description
    const slug = makeSlug(product.name, product.description || "");
    let match = slugToHref.get(slug);

    // If no exact match, try matching by name only
    if (!match) {
      const byName = jsonProducts.find(
        (p) => p.name === product.name && p.description === product.description
      );
      if (byName) {
        match = { href: byName.href, name: byName.name, description: byName.description };
      }
    }

    // Try fuzzy: match by name substring
    if (!match) {
      const byNameFuzzy = jsonProducts.find(
        (p) => p.name === product.name
      );
      if (byNameFuzzy) {
        match = { href: byNameFuzzy.href, name: byNameFuzzy.name, description: byNameFuzzy.description };
      }
    }

    if (match && match.href) {
      urlList.push({
        productId: product.id,
        name: product.name,
        description: product.description,
        url: `https://www.alfaborg.is${match.href}`,
        href: match.href,
      });
    } else {
      noMatch.push({ id: product.id, name: product.name, desc: product.description });
    }
  }

  writeFileSync("scripts/missing-dims-urls.json", JSON.stringify(urlList, null, 2));
  console.log(`\nMatched ${urlList.length} products with URLs`);
  console.log(`Could not match: ${noMatch.length}`);

  if (noMatch.length > 0) {
    console.log("\nUnmatched products:");
    noMatch.forEach((p) => console.log(`  ${p.name}: "${p.desc || ""}"`));
  }

  // Group by unique URL (some products share the same page)
  const uniqueUrls = new Set(urlList.map(u => u.href));
  console.log(`\nUnique pages to scrape: ${uniqueUrls.size}`);

  await prisma.$disconnect();
}

main().catch(console.error);
