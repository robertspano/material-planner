#!/usr/bin/env node

/**
 * Alfaborg Sale Price Scraper
 *
 * Scrapes sale prices from alfaborg.is by:
 * 1. Fetching the sitemap to discover all tilbodsvorur (sale) product URLs
 * 2. Fetching each sale product page and extracting the base64-encoded
 *    Airtable JSON that contains price data
 * 3. Also scraping the sale listing pages for any prices visible in HTML
 * 4. Outputting a JSON mapping of product names to price info
 *
 * The site serves 200 responses to fetch requests with a browser-like User-Agent.
 * No browser automation needed.
 *
 * Run with: node scripts/scrape-prices.js
 */

const SITEMAP_URL = "https://www.alfaborg.is/sitemap.xml";
const BASE_URL = "https://www.alfaborg.is";

const SALE_LISTING_PAGES = [
  "/tilbodsvorur/flisar",
  "/tilbodsvorur/parket",
  "/tilbodsvorur/dukar",
  "/tilbodsvorur/teppi",
  "/tilbodsvorur/badherbergi",
  "/tilbodsvorur/verkfaeri",
  "/tilbodsvorur/efni",
  "/tilbodsvorur/klaedningar",
];

// Known subcategory listing slugs (not product pages)
const LISTING_SLUGS = new Set([
  "flisar",
  "parket",
  "dukar",
  "teppi",
  "badherbergi",
  "verkfaeri",
  "efni",
  "klaedningar",
]);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "is,en;q=0.9",
};

// Delay between requests to be polite
const DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with browser-like headers. Retries once on failure.
 */
async function fetchPage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        console.error(
          `  [${res.status}] ${url}${attempt === 0 ? " (retrying)" : ""}`
        );
        if (attempt === 0) {
          await sleep(2000);
          continue;
        }
        return null;
      }
      return await res.text();
    } catch (err) {
      console.error(
        `  [ERROR] ${url}: ${err.message}${attempt === 0 ? " (retrying)" : ""}`
      );
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * Parse the sitemap XML and return all tilbodsvorur product URLs.
 * Deduplicates by slug (direct URLs and subcategory URLs have same content).
 */
async function getSaleProductUrls() {
  console.log("Fetching sitemap...");
  const xml = await fetchPage(SITEMAP_URL);
  if (!xml) {
    console.error("Failed to fetch sitemap");
    return [];
  }

  const locPattern = /<loc>(https:\/\/www\.alfaborg\.is\/tilbodsvorur\/[^<]+)<\/loc>/g;
  const allUrls = [];
  let match;
  while ((match = locPattern.exec(xml)) !== null) {
    allUrls.push(match[1]);
  }

  // Keep only direct product URLs (not subcategory duplicates, not listing pages)
  const seen = new Set();
  const productUrls = [];
  for (const url of allUrls) {
    const path = url.replace(`${BASE_URL}/tilbodsvorur/`, "");
    const parts = path.split("/");
    const slug = parts[parts.length - 1];

    // Skip listing pages
    if (parts.length === 1 && LISTING_SLUGS.has(slug)) continue;

    // Deduplicate by slug - prefer the direct URL
    if (seen.has(slug)) continue;
    seen.add(slug);

    // Use direct URL format
    productUrls.push(`${BASE_URL}/tilbodsvorur/${slug}`);
  }

  console.log(
    `Found ${allUrls.length} tilbodsvorur URLs in sitemap, ${productUrls.length} unique products`
  );
  return productUrls;
}

/**
 * Extract the base64-encoded Airtable JSON from a sale product page.
 * Returns parsed product data object or null.
 */
function extractBase64ProductData(html) {
  // The page contains a base64-encoded JSON string in single quotes
  // that holds the Airtable record with all product data including prices
  const b64Pattern = /'([A-Za-z0-9+/=]{200,})'/g;
  let match;
  while ((match = b64Pattern.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      const data = JSON.parse(decoded);

      // Verify this is product data by checking for expected fields
      if (data["Product title"] || data["Tilboðsverð"]) {
        return data;
      }
    } catch {
      // Not valid base64 JSON, skip
    }
  }
  return null;
}

/**
 * Extract price info from the HTML text directly (fallback).
 * Looks for visible price patterns like "Tilbodsverð per fm: 4.495 kr"
 */
function extractPricesFromHtml(html) {
  const prices = [];

  // Match tilbodsverð patterns (HTML entity encoded or plain)
  const pricePattern =
    /Tilbo[^\n<]{0,50}?(\d[\d.]+)\s*kr/gi;
  let match;
  while ((match = pricePattern.exec(html)) !== null) {
    prices.push(match[0]);
  }

  return prices;
}

/**
 * Parse a single sale product page and extract structured price data.
 */
function parseProductPage(html, url) {
  const slug = url.split("/").pop();

  // Try base64 JSON extraction first (most reliable)
  const data = extractBase64ProductData(html);
  if (data) {
    const result = {
      slug,
      url,
      title: data["Product title"] || null,
      subtitle: data["Product subtitle"] || data["Size"] || null,
      sku: data["SKU"] || data["SKU (4WEB)"] || null,
      category: data["Product Category (4web)"] || null,
      subCategory: data["Product Sub-Category"] || null,
      isSaleItem: data["Tilboðsvara"] === "true",
      salePrice: data["Tilboðsverð"] ? Number(data["Tilboðsverð"]) : null,
      originalPrice: data["Verð áður"] ? Number(data["Verð áður"]) : null,
      discount: data["Mismunur"] ? Number(data["Mismunur"]) : null,
      discountPercent: data["Mismunur %"] || null,
      salePriceText: data["Tilboðstakki"] || null,
      originalPriceText: data["Tilboðstexti"] || null,
      discountText: data["Mismunur % (texti)"] || null,
      inventoryStatus: data["Inventory status"] || data["Inventory status (4web)"] || null,
      fullUrl: data["Full URL"] || url,
      manufacturer: data["Manufacturer"] || null,
      mainImage: data["Main Image Link"] || null,
    };
    return result;
  }

  // Fallback: try HTML scraping
  const htmlPrices = extractPricesFromHtml(html);
  if (htmlPrices.length > 0) {
    return {
      slug,
      url,
      title: null,
      rawPrices: htmlPrices,
      note: "Extracted from HTML (base64 data not found)",
    };
  }

  return {
    slug,
    url,
    title: null,
    note: "No price data found",
  };
}

/**
 * Scrape prices from sale listing pages (flisar, parket, etc.)
 * These show summary price info for all products in the category.
 */
async function scrapeListingPages() {
  const listingPrices = {};

  for (const path of SALE_LISTING_PAGES) {
    const url = `${BASE_URL}${path}`;
    console.log(`Scraping listing page: ${path}`);
    const html = await fetchPage(url);
    if (!html) continue;

    // Extract product links and their nearby prices
    const linkPattern = /tilbodsvorur\/(?:flisar|parket|dukar|teppi|badherbergi|verkfaeri|efni|klaedningar)\/([^"']+)/g;
    const directLinkPattern = /tilbodsvorur\/([^/"']+)/g;

    const slugs = new Set();
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
      if (!LISTING_SLUGS.has(match[1])) slugs.add(match[1]);
    }
    while ((match = directLinkPattern.exec(html)) !== null) {
      if (!LISTING_SLUGS.has(match[1]) && match[1] !== "~page-item~") {
        slugs.add(match[1]);
      }
    }

    const prices = extractPricesFromHtml(html);
    const category = path.split("/").pop();

    listingPrices[category] = {
      products: [...slugs],
      priceTexts: prices,
      productCount: slugs.size,
    };

    await sleep(DELAY_MS);
  }

  return listingPrices;
}

/**
 * Also check a few regular (non-sale) product pages for price data.
 */
async function checkRegularProductPages() {
  const testUrls = [
    `${BASE_URL}/voruflokkar/flisar/steypuutlit`,
    `${BASE_URL}/voruflokkar/flisar/einlitar-flisar`,
  ];

  console.log("\nChecking regular product pages for price data...");
  for (const url of testUrls) {
    const html = await fetchPage(url);
    if (!html) continue;

    const data = extractBase64ProductData(html);
    const htmlPrices = extractPricesFromHtml(html);

    console.log(`  ${url}`);
    console.log(`    Base64 JSON data: ${data ? "YES" : "NO"}`);
    console.log(`    HTML price text: ${htmlPrices.length > 0 ? htmlPrices.join("; ") : "NONE"}`);
    if (data) {
      const priceKeys = Object.keys(data).filter((k) =>
        /ver|pric|tilbo|mismu|afsl/i.test(k)
      );
      console.log(`    Price-related fields: ${priceKeys.join(", ") || "NONE"}`);
    }
    await sleep(DELAY_MS);
  }
}

/**
 * Main scraping flow.
 */
async function main() {
  console.log("=== Alfaborg Sale Price Scraper ===\n");

  // 1. Get all sale product URLs from sitemap
  const productUrls = await getSaleProductUrls();
  if (productUrls.length === 0) {
    console.error("No sale product URLs found. Exiting.");
    process.exit(1);
  }

  // 2. Scrape each product page
  console.log(`\nScraping ${productUrls.length} sale product pages...\n`);
  const products = [];
  for (let i = 0; i < productUrls.length; i++) {
    const url = productUrls[i];
    const slug = url.split("/").pop();
    process.stdout.write(`  [${i + 1}/${productUrls.length}] ${slug}...`);

    const html = await fetchPage(url);
    if (html) {
      const product = parseProductPage(html, url);
      products.push(product);
      if (product.salePrice) {
        console.log(
          ` ${product.title} - ${product.salePrice} kr (was ${product.originalPrice} kr, ${product.discountPercent})`
        );
      } else if (product.rawPrices) {
        console.log(` ${product.rawPrices[0]}`);
      } else {
        console.log(` ${product.note || "no data"}`);
      }
    } else {
      products.push({ slug, url, note: "Failed to fetch" });
      console.log(" FAILED");
    }

    await sleep(DELAY_MS);
  }

  // 3. Scrape listing pages for overview data
  console.log("\nScraping sale listing pages...\n");
  const listingData = await scrapeListingPages();

  // 4. Check regular product pages
  await checkRegularProductPages();

  // 5. Build output
  const output = {
    scrapedAt: new Date().toISOString(),
    summary: {
      totalSaleProducts: products.length,
      withPriceData: products.filter((p) => p.salePrice != null).length,
      withHtmlPrices: products.filter((p) => p.rawPrices).length,
      noPriceData: products.filter(
        (p) => p.salePrice == null && !p.rawPrices
      ).length,
    },
    products: products,
    listingPages: listingData,
  };

  // Also create a simplified name-to-price mapping
  const priceMap = {};
  for (const p of products) {
    if (p.salePrice != null) {
      const key = p.title
        ? `${p.title}${p.subtitle ? " " + p.subtitle : ""}`
        : p.slug;
      priceMap[key] = {
        salePrice: p.salePrice,
        originalPrice: p.originalPrice,
        discountPercent: p.discountPercent,
        sku: p.sku,
        category: p.category,
      };
    }
  }

  output.priceMap = priceMap;

  // 6. Write output
  const fs = await import("fs");
  const path = await import("path");
  const scriptDir = decodeURIComponent(
    path.dirname(new URL(import.meta.url).pathname)
  );
  const outputPath = path.join(scriptDir, "alfaborg-sale-prices.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n=== Results ===`);
  console.log(`Total sale products: ${output.summary.totalSaleProducts}`);
  console.log(`With full price data: ${output.summary.withPriceData}`);
  console.log(`With HTML-only prices: ${output.summary.withHtmlPrices}`);
  console.log(`No price data: ${output.summary.noPriceData}`);
  console.log(`\nOutput written to: ${outputPath}`);

  // Print price map summary
  console.log(`\n=== Price Map ===`);
  for (const [name, info] of Object.entries(priceMap)) {
    console.log(
      `  ${name}: ${info.salePrice} kr (was ${info.originalPrice} kr, ${info.discountPercent})`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
