import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import * as cheerio from "cheerio";

// ── Types ───────────────────────────────────────────────────────────
type DetectedCategory = "flisar" | "parket" | "vinyl" | "annad";

interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  swatchUrl: string | null;
  tileWidth: number | null;
  tileHeight: number | null;
  tileThickness: number | null;
  color: string | null;
  description: string | null;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low";
  detectedCategory: DetectedCategory;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse Icelandic price formats: "4.500 kr", "4.500 kr/m²", "kr 4,500", "12345" */
function parseIcelandicPrice(text: string): number | null {
  if (!text) return null;
  // Remove currency labels and units
  let cleaned = text
    .replace(/kr\.?\s*\/?\s*m[²2]?/gi, "")
    .replace(/kr\.?/gi, "")
    .replace(/ISK/gi, "")
    .replace(/\/\s*stk\.?/gi, "")
    .replace(/,-/g, "")
    .trim();

  if (!cleaned) return null;

  // Handle Icelandic format: 4.500 (dot = thousands) or 4,500
  // Check if there's a comma followed by exactly 2 digits at the end (decimal)
  const hasDecimal = /,\d{2}$/.test(cleaned);

  if (hasDecimal) {
    // European format: 4.500,50 → 4500.50
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // Icelandic: 4.500 (dot = thousands separator) or 4,500 (comma = thousands)
    cleaned = cleaned.replace(/[.,\s]/g, "");
  }

  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0 || num > 10_000_000) return null;
  return num;
}

/** Parse dimensions: "60x120", "600x600mm", "60 × 120 cm", "60x120x10mm" */
function parseDimensions(text: string): {
  width: number | null;
  height: number | null;
  thickness: number | null;
} {
  const result = { width: null as number | null, height: null as number | null, thickness: null as number | null };
  if (!text) return result;

  // Match dimension patterns
  const dimMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*[x×X]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×X]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)?/i
  );
  if (!dimMatch) return result;

  let w = parseFloat(dimMatch[1].replace(",", "."));
  let h = parseFloat(dimMatch[2].replace(",", "."));
  let t = dimMatch[3] ? parseFloat(dimMatch[3].replace(",", ".")) : null;
  const unit = (dimMatch[4] || "").toLowerCase();

  // Normalize to cm for width/height
  if (unit === "mm" || w >= 100) {
    // Likely mm → convert to cm
    w = w / 10;
    h = h / 10;
    // Thickness stays in mm
  }
  // If unit is "m" — multiply by 100
  if (unit === "m" && w < 10) {
    w = w * 100;
    h = h * 100;
  }

  result.width = Math.round(w * 10) / 10;
  result.height = Math.round(h * 10) / 10;
  if (t !== null) {
    // Thickness: if already in mm range, keep. If tiny (< 1), convert from cm
    if (t < 1 && unit !== "mm") t = t * 10;
    result.thickness = Math.round(t * 10) / 10;
  }

  return result;
}

/** Parse standalone thickness: "10mm", "8 mm", "þykkt: 10mm" */
function parseThickness(text: string): number | null {
  const match = text.match(/(?:þykkt|thickness|tjykn)[:\s]*(\d+(?:[.,]\d+)?)\s*mm/i)
    || text.match(/(\d+(?:[.,]\d+)?)\s*mm(?:\s|$|,)/i);
  if (!match) return null;
  const val = parseFloat(match[1].replace(",", "."));
  if (val > 0 && val < 100) return val;
  return null;
}

/** Resolve relative URL to absolute */
function resolveUrl(url: string | undefined | null, base: URL): string | null {
  if (!url) return null;
  url = url.trim();
  if (!url || url === "#" || url.startsWith("javascript:") || url.startsWith("data:")) return null;
  try {
    if (url.startsWith("//")) return `${base.protocol}${url}`;
    if (url.startsWith("/")) return `${base.origin}${url}`;
    if (url.startsWith("http")) return url;
    return new URL(url, base.origin).href;
  } catch {
    return null;
  }
}

/** Extract best image src from an element, handling lazy loading */
function extractImageSrc(el: cheerio.Cheerio<any>, $: cheerio.CheerioAPI, base: URL): string | null {
  const img = el.is("img") ? el : el.find("img").first();
  if (!img.length) {
    // Try background-image
    const style = el.attr("style") || "";
    const bgMatch = style.match(/background-image:\s*url\(['"]?([^'")\s]+)['"]?\)/i);
    if (bgMatch) return resolveUrl(bgMatch[1], base);
    return null;
  }

  // Priority: data-src > data-lazy-src > data-original > srcset > src
  const candidates = [
    img.attr("data-src"),
    img.attr("data-lazy-src"),
    img.attr("data-original"),
    img.attr("data-image"),
  ].filter(Boolean);

  // Parse srcset for highest resolution
  const srcset = img.attr("srcset") || img.attr("data-srcset");
  if (srcset) {
    const parts = srcset.split(",").map(s => s.trim().split(/\s+/));
    // Sort by width descriptor descending
    const sorted = parts
      .filter(p => p[0])
      .sort((a, b) => {
        const aw = parseInt(a[1]) || 0;
        const bw = parseInt(b[1]) || 0;
        return bw - aw;
      });
    if (sorted.length > 0) candidates.push(sorted[0][0]);
  }

  candidates.push(img.attr("src"));

  for (const src of candidates) {
    if (!src) continue;
    // Skip placeholders and tiny images
    if (/placeholder|loading|spinner|blank|pixel|1x1|data:image/i.test(src)) continue;
    const resolved = resolveUrl(src, base);
    if (resolved) return resolved;
  }

  return null;
}

/** Decode HTML entities */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Clean product name */
function cleanName(name: string): string {
  return decodeEntities(name)
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—·•]+|[\s\-–—·•]+$/g, "")
    .trim();
}

// ── Category Detection ──────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<Exclude<DetectedCategory, "annad">, RegExp> = {
  flisar: /fl[ií]s|tile|ceramic|keramik|porcel[aá]n|mosaic|mósaík|veggfl|gólffl|steingólf|stein(?:efni)?|marble|marmari/i,
  parket: /parket|parquet|hardwood|eik(?:ar)?[\s-]|oak|birki|birch|ash[\s-]|beech|plank|laminat|laminate|timbur|timber|viður|wood[\s-]?floor/i,
  vinyl: /vinyl|v[ií]nyl|lvt|spc|lin[oó]leum|pvc|click[\s-]?floor|luxury[\s-]?vinyl/i,
};

/** Detect product category from text (name, description, URL) */
function detectCategory(texts: string[]): DetectedCategory {
  const combined = texts.filter(Boolean).join(" ").toLowerCase();

  // Check each category's keywords
  for (const [cat, regex] of Object.entries(CATEGORY_KEYWORDS) as [string, RegExp][]) {
    if (regex.test(combined)) return cat as DetectedCategory;
  }

  return "annad";
}

/** Detect the overall page category from URL path and page title */
function detectPageCategory(url: string, pageTitle: string): DetectedCategory | null {
  const text = `${url} ${pageTitle}`.toLowerCase();
  for (const [cat, regex] of Object.entries(CATEGORY_KEYWORDS) as [string, RegExp][]) {
    if (regex.test(text)) return cat as DetectedCategory;
  }
  return null;
}

// ── JSON-LD Extraction ──────────────────────────────────────────────

function extractFromJsonLd($: cheerio.CheerioAPI, base: URL): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).text();
      const data = JSON.parse(text);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        // Handle @graph arrays
        const graphs = item["@graph"] ? item["@graph"] : [item];
        for (const node of graphs) {
          if (node["@type"] === "Product" || node["@type"] === "IndividualProduct") {
            const product = parseJsonLdProduct(node, base);
            if (product) products.push(product);
          }
          // ItemList containing Products
          if (node["@type"] === "ItemList" && node.itemListElement) {
            for (const listItem of node.itemListElement) {
              const inner = listItem.item || listItem;
              if (inner["@type"] === "Product" || inner.name) {
                const product = parseJsonLdProduct(inner, base);
                if (product) products.push(product);
              }
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  });

  return products;
}

function parseJsonLdProduct(node: Record<string, unknown>, base: URL): ScrapedProduct | null {
  const name = node.name as string;
  if (!name) return null;

  let price: number | null = null;
  let currency = "ISK";
  const offers = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
  if (offers) {
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (offer) {
      price = parseFloat(String(offer.price || offer.lowPrice || "")) || null;
      currency = (offer.priceCurrency as string) || "ISK";
    }
  }

  let imageUrl: string | null = null;
  const image = node.image;
  if (typeof image === "string") {
    imageUrl = resolveUrl(image, base);
  } else if (Array.isArray(image) && image.length > 0) {
    imageUrl = resolveUrl(typeof image[0] === "string" ? image[0] : (image[0] as Record<string, unknown>).url as string, base);
  } else if (image && typeof image === "object") {
    imageUrl = resolveUrl((image as Record<string, unknown>).url as string, base);
  }

  const description = (node.description as string) || null;
  const sourceUrl = resolveUrl(node.url as string, base);

  // Try to extract dimensions from description or additionalProperty
  const dims = parseDimensions(description || "");
  let thickness = dims.thickness;
  if (!thickness && description) {
    thickness = parseThickness(description);
  }

  let color: string | null = null;
  if (node.color) {
    color = String(node.color);
  }
  // Check additionalProperty for dimensions
  const additionalProps = node.additionalProperty as Record<string, unknown>[] | undefined;
  if (additionalProps && Array.isArray(additionalProps)) {
    for (const prop of additionalProps) {
      const propName = String(prop.name || "").toLowerCase();
      const propValue = String(prop.value || "");
      if (propName.includes("color") || propName.includes("litur")) {
        color = propValue;
      }
      if (propName.includes("size") || propName.includes("stærð") || propName.includes("mál")) {
        const d = parseDimensions(propValue);
        if (d.width) { dims.width = d.width; dims.height = d.height; }
        if (d.thickness) thickness = d.thickness;
      }
    }
  }

  const cleanedName = cleanName(name);

  return {
    name: cleanedName,
    price,
    currency,
    imageUrl,
    swatchUrl: null,
    tileWidth: dims.width,
    tileHeight: dims.height,
    tileThickness: thickness,
    color,
    description: description ? cleanName(description).slice(0, 300) : null,
    sourceUrl,
    confidence: imageUrl && price ? "high" : imageUrl || price ? "medium" : "low",
    detectedCategory: detectCategory([cleanedName, description || "", sourceUrl || ""]),
  };
}

// ── DOM-based Extraction ────────────────────────────────────────────

function extractFromDom($: cheerio.CheerioAPI, base: URL): ScrapedProduct[] {
  const products: ScrapedProduct[] = [];

  // Strategy 1: Find product grid via known selectors
  const gridSelectors = [
    ".products", ".product-list", ".product-grid", ".product-listing",
    "[class*='product-grid']", "[class*='product-list']", "[class*='productGrid']",
    ".woocommerce ul.products", "ul.products",
    "[class*='catalog']", "[class*='items']",
    ".category-products", ".search-results",
    // Common Icelandic e-commerce patterns
    "[class*='voru']", "[class*='vara']",
  ];

  let container: cheerio.Cheerio<any> | null = null;

  for (const selector of gridSelectors) {
    const found = $(selector).first();
    if (found.length && found.children().length >= 2) {
      container = found;
      break;
    }
  }

  // Strategy 2: Find cards directly
  const cardSelectors = [
    ".product", ".product-card", ".product-item", ".product-tile",
    "[class*='product-card']", "[class*='productCard']", "[class*='product-item']",
    ".woocommerce li.product", "li.product",
    ".grid-item", ".catalog-item", ".item-card",
    "[class*='ProductCard']", "[class*='product_card']",
    // Broader patterns
    "[data-product-id]", "[data-product]", "[data-item-id]",
  ];

  let cards: cheerio.Cheerio<any> | null = null;

  if (container) {
    cards = container.children();
  } else {
    // Try card selectors
    for (const sel of cardSelectors) {
      const found = $(sel);
      if (found.length >= 2) {
        cards = found;
        break;
      }
    }
    if (!cards || !cards.length) {
      cards = findProductCardsHeuristic($);
    }
  }

  if (!cards || !cards.length) return products;

  cards.each((_, el) => {
    const card = $(el);
    const product = extractProductFromCard(card, $, base);
    if (product) products.push(product);
  });

  return products;
}

/** Heuristic: find the largest group of similar sibling elements that contain images */
function findProductCardsHeuristic($: cheerio.CheerioAPI): cheerio.Cheerio<any> {
  let bestGroup: any[] = [];

  // Check common wrapper elements
  $("main, [role='main'], .content, #content, .main").each((_, wrapper) => {
    const $wrapper = $(wrapper);
    // Find elements that look like cards: have an image and some text
    $wrapper.find("div, li, article, section").each((_, parent) => {
      const $parent = $(parent);
      const children = $parent.children();
      if (children.length < 3) return;

      // Count how many children have both an img and text
      let productLikeCount = 0;
      children.each((_, child) => {
        const $child = $(child);
        if ($child.find("img").length > 0 && $child.text().trim().length > 10) {
          productLikeCount++;
        }
      });

      if (productLikeCount >= 3 && productLikeCount > bestGroup.length) {
        bestGroup = [];
        children.each((_, child) => {
          const $child = $(child);
          if ($child.find("img").length > 0 && $child.text().trim().length > 10) {
            bestGroup.push(child);
          }
        });
      }
    });
  });

  return cheerio.load("")(bestGroup) as unknown as cheerio.Cheerio<any>;
}

function extractProductFromCard(
  card: cheerio.Cheerio<any>,
  $: cheerio.CheerioAPI,
  base: URL
): ScrapedProduct | null {
  // ── Extract Name ──
  let name: string | null = null;

  // Try headings first
  const headings = card.find("h1, h2, h3, h4, h5, h6");
  if (headings.length) {
    name = headings.first().text().trim();
  }

  // Try name/title class patterns
  if (!name || name.length < 2) {
    const nameEl = card.find(
      "[class*='name'], [class*='title'], [class*='product-name'], [class*='product-title'], " +
      "[class*='productName'], [class*='productTitle'], [class*='item-name'], [class*='item-title']"
    ).first();
    if (nameEl.length) name = nameEl.text().trim();
  }

  // Try first link text
  if (!name || name.length < 2) {
    const firstLink = card.find("a").first();
    if (firstLink.length) {
      const linkText = firstLink.text().trim();
      if (linkText.length > 2 && linkText.length < 200) name = linkText;
    }
  }

  if (!name || name.length < 2) return null;
  name = cleanName(name);
  if (name.length < 2) return null;

  // ── Extract Image ──
  const imageUrl = extractImageSrc(card, $, base);

  // ── Extract Price ──
  let price: number | null = null;

  // Try price class patterns
  const priceEl = card.find(
    "[class*='price'], .woocommerce-Price-amount, [class*='Price'], [class*='verð'], " +
    "[class*='verd'], [data-price]"
  ).first();
  if (priceEl.length) {
    price = parseIcelandicPrice(priceEl.text());
  }

  // Fallback: search all text for price patterns
  if (price === null) {
    const allText = card.text();
    const priceMatches = allText.match(/[\d.,]+\s*(?:kr\.?|ISK)/gi);
    if (priceMatches) {
      for (const match of priceMatches) {
        const parsed = parseIcelandicPrice(match);
        if (parsed && parsed > 10) { price = parsed; break; }
      }
    }
  }

  // ── Extract Link ──
  let sourceUrl: string | null = null;
  const link = card.find("a[href]").first();
  if (link.length) {
    const href = link.attr("href");
    if (href && href !== "#" && !href.startsWith("javascript:")) {
      sourceUrl = resolveUrl(href, base);
    }
  }

  // ── Extract Dimensions ──
  const cardText = card.text();
  const dims = parseDimensions(cardText);
  let thickness = dims.thickness;
  if (!thickness) thickness = parseThickness(cardText);

  // ── Extract Color ──
  let color: string | null = null;
  const colorEl = card.find(
    "[class*='color'], [class*='swatch'], [class*='litur'], [class*='Color']"
  ).first();
  if (colorEl.length) {
    // Check for background-color inline style
    const bgColor = colorEl.attr("style")?.match(/background-color:\s*([^;]+)/i);
    if (bgColor) {
      color = bgColor[1].trim();
    } else {
      const colorText = colorEl.text().trim();
      if (colorText.length > 0 && colorText.length < 50) color = colorText;
    }
  }

  // ── Extract Description ──
  let description: string | null = null;
  const descEl = card.find(
    "[class*='description'], [class*='desc'], [class*='excerpt'], [class*='summary'], p"
  ).first();
  if (descEl.length) {
    const descText = descEl.text().trim();
    if (descText.length > 10 && descText.length < 500 && descText !== name) {
      description = cleanName(descText).slice(0, 300);
    }
  }

  // ── Confidence ──
  const confidence: "high" | "medium" | "low" =
    imageUrl && price ? "high" :
    imageUrl || price ? "medium" : "low";

  return {
    name,
    price,
    currency: "ISK",
    imageUrl,
    swatchUrl: null,
    tileWidth: dims.width,
    tileHeight: dims.height,
    tileThickness: thickness,
    color,
    description,
    sourceUrl,
    confidence,
    detectedCategory: detectCategory([name, description || "", sourceUrl || "", cardText]),
  };
}

// ── Pagination Detection ────────────────────────────────────────────

function detectPagination($: cheerio.CheerioAPI): boolean {
  // Look for next page links
  const nextSelectors = [
    "a[rel='next']", "[class*='next']", "[class*='pagination'] a",
    "a:contains('Næsta')", "a:contains('Next')", "a:contains('›')", "a:contains('»')",
  ];
  for (const sel of nextSelectors) {
    if ($(sel).length > 0) return true;
  }
  // URL patterns
  const links = $("a[href*='page='], a[href*='/page/']");
  return links.length > 0;
}

// ── Deduplication ───────────────────────────────────────────────────

function deduplicateProducts(products: ScrapedProduct[]): ScrapedProduct[] {
  const seen = new Map<string, ScrapedProduct>();
  for (const p of products) {
    const key = p.name.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || (p.confidence === "high" && existing.confidence !== "high")) {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}

// ── Main Handler ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    // Fetch the page
    const res = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "is,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Gat ekki sótt vefsíðu (${res.status})` }, { status: 400 });
    }

    const html = await res.text();
    const baseUrl = new URL(normalizedUrl);
    const $ = cheerio.load(html);

    // Get page title
    const pageTitle = $("title").first().text().trim() || $("h1").first().text().trim() || baseUrl.hostname;

    const warnings: string[] = [];
    let source: "json-ld" | "dom-parsing" | "heuristic" = "dom-parsing";

    // Strategy 1: Try JSON-LD first
    let products = extractFromJsonLd($, baseUrl);
    if (products.length > 0) {
      source = "json-ld";
    }

    // Strategy 2: DOM parsing (always run to augment JSON-LD results)
    const domProducts = extractFromDom($, baseUrl);
    if (products.length === 0) {
      products = domProducts;
      source = domProducts.length > 0 ? "dom-parsing" : "heuristic";
    } else if (domProducts.length > products.length) {
      // DOM found more products, merge — prefer DOM if significantly more
      const jsonLdNames = new Set(products.map(p => p.name.toLowerCase()));
      for (const dp of domProducts) {
        if (!jsonLdNames.has(dp.name.toLowerCase())) {
          products.push(dp);
        }
      }
    }

    // Deduplicate
    products = deduplicateProducts(products);

    // Apply page-level category if individual products couldn't detect one
    const pageCategory = detectPageCategory(normalizedUrl, pageTitle);
    if (pageCategory) {
      for (const p of products) {
        if (p.detectedCategory === "annad") {
          p.detectedCategory = pageCategory;
        }
      }
    }

    // Cap at 100 products
    if (products.length > 100) {
      warnings.push(`Fundust ${products.length} vörur, sýni fyrstu 100`);
      products = products.slice(0, 100);
    }

    // Detect pagination
    if (detectPagination($)) {
      warnings.push("Fleiri síður fundust — aðeins fyrsta síðan var skönnuð");
    }

    // Build category summary
    const categoryCounts: Record<string, number> = {};
    for (const p of products) {
      categoryCounts[p.detectedCategory] = (categoryCounts[p.detectedCategory] || 0) + 1;
    }

    return NextResponse.json({
      products,
      source,
      pageTitle: cleanName(pageTitle),
      totalFound: products.length,
      warnings,
      categoryCounts,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Scrape products error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Villa við að sækja vörur: ${msg}` }, { status: 500 });
  }
}
