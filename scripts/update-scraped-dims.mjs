/**
 * Update product dimensions from scraped data.
 *
 * This script takes the dimensions scraped from alfaborg.is and writes them
 * to the database, matching by product ID via the href→productId mapping
 * in missing-dims-urls.json.
 *
 * Run: node scripts/update-scraped-dims.mjs
 */

import { PrismaClient } from "../src/generated/prisma/index.js";
import { readFileSync } from "fs";

const prisma = new PrismaClient();

// Scraped dimensions: href → { w (cm), h (cm), t (mm or null) }
const scrapedDims = {
  "/voruflokkar/flisar/bauhome-9-litir-og-18-mynstur": { w: 20, h: 20, t: null },
  "/voruflokkar/flisar/caprice-5-litirpoint-17-decor": { w: 20, h: 20, t: null },
  "/voruflokkar/parket/hardparket/cadenza-dark-brown": { w: 24.1, h: 138.3, t: 8 },
  "/voruflokkar/parket/hardparket/cadenza-allegro-light": { w: 24.1, h: 138.3, t: 8 },
  "/voruflokkar/flisar/octagon-6-litir": { w: 20, h: 20, t: null },
  "/voruflokkar/flisar/hexatile-cement-6-litirpoint-4-decor": { w: 17.5, h: 20, t: null },
  "/voruflokkar/flisar/wadi-10-litir": { w: 6, h: 30, t: null },
  "/voruflokkar/flisar/rivoli-6-litirpoint-17-decor": { w: 20, h: 20, t: null },
  "/voruflokkar/flisar/coco-10-litir": { w: 5, h: 15, t: null },
  "/voruflokkar/parket/hardparket/woodstock-xl-summit-oak-cream-ac5-4v-10m": { w: 24.4, h: 184.5, t: 10 },
  "/voruflokkar/parket/grace-oak-white-lace-tres-3-strip-": { w: 19.4, h: 228.1, t: null },
  "/voruflokkar/parket/spirit-xl--lvt-vinylparket-smellt-long-range-cl": { w: 22.8, h: 183, t: null },
  "/voruflokkar/parket/spirit-xl--lvt-vinylparket-smellt-sierra-high-cl": { w: 22.8, h: 183, t: null },
  "/voruflokkar/parket/spirit-xl--lvt-vinylparket-smellt-yosemite-cl-": { w: 22.8, h: 183, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-elite-sand-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-sorrento": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/pure--lvt-vinylparket-smellt-classic-oak-brown": { w: 20.4, h: 131.7, t: null },
  "/voruflokkar/flisar/vitral-12-litir": { w: 20, h: 20, t: null },
  "/voruflokkar/flisar/costa-nova-15-litir": { w: 5, h: 20, t: null },
  "/voruflokkar/parket/hardparket/connect-plus-xl8-xl8-gyant-brown-natural": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/heritage-oak-lime-stone-2-lock-2200mm": { w: 19, h: 220, t: 14 },
  "/voruflokkar/parket/pure--eik-natur-162-2-lock-14mm": { w: 16.2, h: 220, t: 14 },
  "/voruflokkar/parket/pure-oak-natur-3ja-stafa-13mm-pn": { w: 19.8, h: 228.1, t: 13 },
  "/voruflokkar/parket/spirit-xl--lvt-vinylparket-smellt-kings-canyon-cl": { w: 22.8, h: 183, t: null },
  "/voruflokkar/parket/starfloor-cl-ultimate--lvt-vinylparket-smellt-bleached-oak-brown": { w: 22, h: 150, t: null },
  "/voruflokkar/flisar/art-nouveau-12-litirpoint-22-decor": { w: 20, h: 20, t: null },
  "/voruflokkar/flisar/heritage-8-litir-": { w: 7, h: 28, t: null },
  "/voruflokkar/flisar/country-12-litirpoint-1-decor": { w: 6.5, h: 20, t: null },
  "/voruflokkar/flisar/hexatile-4-litirpoint-4-decor": { w: 17.5, h: 20, t: null },
  "/voruflokkar/flisar/magma-10-litir": { w: 6.5, h: 20, t: null },
  "/voruflokkar/flisar/metro-11-litirpoint-2-decor": { w: 7.5, h: 15, t: null },
  "/voruflokkar/flisar/masia-11-litir": { w: 7.5, h: 30, t: null },
  "/voruflokkar/flisar/micro-7-litirpoint-10-decor": { w: 5, h: 5, t: null },
  "/voruflokkar/flisar/vibe-10-litir": { w: 6.5, h: 20, t: null },
  "/voruflokkar/flisar/village-15-litir": { w: 6.5, h: 20, t: null },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-gyant-light-sand": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/prestige-oak-boardwalk-2-lock": { w: 19, h: 200, t: 14 },
  "/voruflokkar/parket/spirit-xl--lvt-vinylparket-smellt-fitz-roy-cl": { w: 22.8, h: 183, t: null },
  "/voruflokkar/flisar/splendours-7-litir": { w: 15, h: 45, t: null },
  "/voruflokkar/flisar/argile-9-litir": { w: 6, h: 24.6, t: null },
  "/voruflokkar/flisar/arrow-14-litir": { w: 5, h: 25, t: null },
  "/voruflokkar/flisar/evolution-8-litirpoint-10-decor": { w: 7.5, h: 15, t: null },
  "/voruflokkar/parket/hardparket/cadenza-allegro-natural": { w: 24.1, h: 138.3, t: 8 },
  "/voruflokkar/parket/hardparket/cadenza-brown": { w: 24.1, h: 138.3, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-gyant-sand-natural": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/heritage-oak-urban-grey-hardvax-oil-14mm": { w: 19, h: 200, t: 14 },
  "/voruflokkar/parket/pure-eik-natur-3st-2-lock": { w: 19.8, h: 228.1, t: null },
  "/voruflokkar/flisar/altea-9-litir": { w: 7.5, h: 30, t: null },
  "/voruflokkar/flisar/cottage-9-litir": { w: 7.5, h: 30, t: null },
  "/voruflokkar/parket/hardparket/cadenza-light-grey": { w: 24.1, h: 138.3, t: 8 },
  "/voruflokkar/parket/grace-oak-nature-tres-3-strip-": { w: 19.4, h: 228.1, t: null },
  "/voruflokkar/parket/grace-oak-white-canvas-tres-3-strip-": { w: 19.4, h: 228.1, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-elite-taupe-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-country-honey": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-elite-greige-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-country-mokka-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-smoked-country-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-faro": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/click-solid-55--lvt-vinylparket-smellt-modern-oak-white-click": { w: 14.1, h: 24, t: null },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-delicate-oak-sugar-click": { w: 18.7, h: 120, t: null },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-high-oak-taupe-click": { w: 20, h: 120, t: null },
  "/voruflokkar/flisar/hanoi-9-litir": { w: 5.1, h: 16.1, t: null },
  "/voruflokkar/flisar/bali-10-litir": { w: 5, h: 40, t: null },
  "/voruflokkar/flisar/manacor-10-litir": { w: 7.5, h: 45, t: null },
  "/voruflokkar/flisar/stromboli-12-litir": { w: 9.2, h: 36.8, t: null },
  "/voruflokkar/flisar/kasbah-21-litirpoint-3-staerdir": { w: 12.5, h: 12.5, t: null },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-bloom-silver-grey": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-bloom-sand-natural": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-gyant-warm-brown": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-gyant-warm-natural": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/connect-xl8-bloom-sand-natural": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/connect-8-v4-bloom-natural": { w: 19, h: 128.8, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-xl8-select-light-brown": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/ocean-plus-xl8-bloom-sand-natural-ac5": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/woodstock-xl-summit-oak-titan-ac5-4v-10m": { w: 24.4, h: 184.5, t: 10 },
  "/voruflokkar/parket/grace-oak-beige-cashmere-plank-xt-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/eik-pure-cashmere-plank": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/hardparket/connect-plus-xl8-xl8-bloom-light-brown": { w: 24.1, h: 203.8, t: 8 },
  "/voruflokkar/parket/hardparket/woodstock-xl-summit-oak-grey-ac5-4v-10mm": { w: 24.4, h: 184.5, t: 10 },
  "/voruflokkar/parket/hardparket/ocean-v4-bloom-natural": { w: 19, h: 128.8, t: 8 },
  "/voruflokkar/parket/grace-oak-era-basket-weave-": { w: 12.2, h: 58.5, t: null },
  "/voruflokkar/parket/grace-oak-grey-chiffon-plank-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/grace-oak-white-canvas-plank-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/heritage-oak-old-gray-14mm-1-strip": { w: 19, h: 200, t: 14 },
  "/voruflokkar/parket/grace-oak-century-basket-weave-": { w: 12.2, h: 58.5, t: null },
  "/voruflokkar/parket/grace-oak-soft-skin-tres-3-strip-": { w: 19.4, h: 228.1, t: null },
  "/voruflokkar/parket/prestige-oak-sand-14mm-2-loc": { w: 19, h: 200, t: 14 },
  "/voruflokkar/parket/eik-robust-eik-robust-matt-lakk-14mm-3-strip": { w: 19.8, h: 228.1, t: 14 },
  "/voruflokkar/parket/eik-rumba-xt-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/grace-oak-white-lace-plank-xt-1-strip": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/grace-oak-soft-skin-plank-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-elite-beige-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-elite-natural": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-dark-brown-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-brown-cl": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/zenn-click-comfort-30--lvt-vinylparket-smellt-oslo": { w: 17.8, h: 121.9, t: 5 },
  "/voruflokkar/parket/spirit-pro--lvt-vinylparket-smellt-country-beige-cl-": { w: 22.8, h: 121.9, t: null },
  "/voruflokkar/parket/zenn-click-comfort-30--lvt-vinylparket-smellt-porto": { w: 17.8, h: 121.9, t: 5 },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-porto": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-season-oak-beige-click": { w: 18.7, h: 120, t: null },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-delicate-oak-brown-click": { w: 18.7, h: 120, t: null },
  "/voruflokkar/parket/grace-oak-rustic-plank-xt-1-strip-": { w: 13.8, h: 200, t: null },
  "/voruflokkar/parket/pure-eik-robust-matt-lakk-14mm-2-lock": { w: 19.8, h: 228.1, t: 14 },
  "/voruflokkar/parket/heritage-oak-hardvax-oil-14mm-2200mm": { w: 19, h: 220, t: 14 },
  "/voruflokkar/parket/shade-oak-evening-grey-midiplank": { w: 13.4, h: 185, t: 13 },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-limousin-oak-grege-click": { w: 18.7, h: 120, t: null },
  "/voruflokkar/parket/zenn-click-comfort-30--lvt-vinylparket-smellt-orlando": { w: 17.8, h: 121.9, t: 5 },
  "/voruflokkar/parket/zenn-click-comfort-30--lvt-vinylparket-smellt-cairo": { w: 17.8, h: 121.9, t: 5 },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-cairo": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/pure--lvt-vinylparket-smellt-columbian-oak-946m": { w: 20.4, h: 131.7, t: null },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-monsanto": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-oslo": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-palermo": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/zenn-herringbone--lvt-vinylparket-smellt-orlando": { w: 10.8, h: 61, t: 6 },
  "/voruflokkar/parket/click-solid-55--lvt-vinylparket-smellt-english-oak-natural": { w: 14.1, h: 24, t: null },
  "/voruflokkar/parket/click-solid-55--lvt-vinylparket-smellt-antik-oak-dark-grey": { w: 14.1, h: 24, t: null },
  "/voruflokkar/parket/starfloor-cl-ultimate--lvt-vinylparket-smellt-bleached-oak-grege": { w: 22, h: 150, t: null },
  "/voruflokkar/parket/elegance-rigid-55--lvt-vinylparket-smellt-contemporary-oak-natural-click": { w: 18.7, h: 120, t: null },
  "/voruflokkar/parket/hardparket/connect-plus-xl8-xl8-ragnar-light-sand-": { w: 24.1, h: 203.8, t: 8 },
  // SHADE products (mm x mm x mm format)
  "/voruflokkar/parket/shade-oak-cream-white-midiplank": { w: 13.4, h: 185, t: 13 },
  "/voruflokkar/parket/shade-oak-cream-tres-13pn": { w: 19.4, h: 228.1, t: 13 },
  "/voruflokkar/parket/shade-ash-melange-13mm194-3-2-l": { w: 19.4, h: 228.1, t: 13 },
  "/voruflokkar/parket/shade-oak-cream-white-190mm-2-lock": { w: 19, h: 200, t: 14 },
  "/voruflokkar/parket/shade--oak-robust-craem-14mm-162-2-lo": { w: 16.2, h: 220, t: 14 },
};

async function main() {
  // Load the href → productId mapping
  const mappingPath = new URL("./missing-dims-urls.json", import.meta.url);
  const mappings = JSON.parse(readFileSync(mappingPath, "utf-8"));

  // Build href → productId lookup
  const hrefToProductId = {};
  for (const m of mappings) {
    hrefToProductId[m.href] = m.productId;
  }

  console.log(`Scraped dimensions: ${Object.keys(scrapedDims).length}`);
  console.log(`Product mappings: ${mappings.length}`);

  let updated = 0;
  let skipped = 0;
  let noMapping = 0;

  for (const [href, dims] of Object.entries(scrapedDims)) {
    const productId = hrefToProductId[href];
    if (!productId) {
      console.log(`  ⚠ No product mapping for: ${href}`);
      noMapping++;
      continue;
    }

    try {
      await prisma.product.update({
        where: { id: productId },
        data: {
          tileWidth: dims.w,
          tileHeight: dims.h,
          ...(dims.t !== null && { tileThickness: dims.t }),
        },
      });
      updated++;
      console.log(`  ✓ ${productId}: ${dims.w}×${dims.h} cm${dims.t ? ` (${dims.t}mm)` : ""}`);
    } catch (err) {
      console.error(`  ✗ Failed ${productId}: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped/failed: ${skipped}`);
  console.log(`  No mapping: ${noMapping}`);

  // Overall count
  const totalWithDims = await prisma.product.count({ where: { tileWidth: { not: null } } });
  const totalProducts = await prisma.product.count();
  console.log(`\nOverall: ${totalWithDims}/${totalProducts} products have dimensions`);

  // Show remaining products without dimensions
  const remaining = await prisma.product.findMany({
    where: { tileWidth: null },
    select: { id: true, name: true, description: true },
  });
  if (remaining.length > 0) {
    console.log(`\nStill missing (${remaining.length}):`);
    for (const p of remaining) {
      console.log(`  ${p.id}: ${p.name} | "${p.description || ""}"`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
