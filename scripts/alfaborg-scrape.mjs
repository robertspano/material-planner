#!/usr/bin/env node

/**
 * Alfaborg Product Scraper
 *
 * This script collects product data from alfaborg.is using puppeteer-like navigation.
 * Since direct HTTP requests get 403'd, we use a different approach:
 * We'll store manually scraped data from the browser and import it.
 *
 * Run with: node scripts/alfaborg-scrape.mjs
 */

// Categories to scrape from Alfaborg
const CATEGORIES = {
  flisar: {
    name: 'Flísar',
    surfaceType: 'both', // tiles can be floor or wall
    subcategories: [
      { name: 'Einlitar flísar', slug: 'einlitar-flisar', url: '/voruflokkar/flisar/einlitar-flisar' },
      { name: 'Náttúrusteinsútlit', slug: 'natturusteinsutlit', url: '/voruflokkar/flisar/natturusteinsutlit' },
      { name: 'Steypuútlit', slug: 'steypuutlit', url: '/voruflokkar/flisar/steypuutlit' },
      { name: 'Marmaraútlit', slug: 'marmarautlit', url: '/voruflokkar/flisar/marmarautlit' },
      { name: 'Iðnaðarflísar', slug: 'idnadarflisar', url: '/voruflokkar/flisar/vidarutlit' },
      { name: 'Viðarútlit', slug: 'vidarutlit-flisar', url: '/voruflokkar/flisar/vi%C3%B0ar%C3%BAtlit' },
      { name: 'Mynstur- og skrautflísar', slug: 'mynstur-og-skrautflisar', url: '/voruflokkar/flisar/mynstur-og-skrautflisar' },
      { name: 'Terrazzoútlit', slug: 'terrazzoutlit', url: '/voruflokkar/flisar/terrazzoutlit' },
      { name: 'Útiflísar', slug: 'utiflisar', url: '/voruflokkar/flisar/utiflisar' },
    ]
  },
  parket: {
    name: 'Parket',
    surfaceType: 'floor',
    subcategories: [] // Will discover from navigation
  },
  veggfodur: {
    name: 'Veggfóður',
    surfaceType: 'wall',
    subcategories: []
  }
};

console.log('Alfaborg categories to scrape:');
Object.entries(CATEGORIES).forEach(([key, cat]) => {
  console.log(`  ${cat.name}: ${cat.subcategories.length} subcategories`);
});
console.log('\nUse the browser MCP tools to scrape, then run alfaborg-import.mjs to import.');
