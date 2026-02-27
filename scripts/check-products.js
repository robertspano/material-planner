const { PrismaClient } = require('../src/generated/prisma');
const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: { company: { slug: 'alfaborg' } },
    include: { category: true },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }]
  });

  // Group by category
  const cats = {};
  products.forEach(p => {
    const cat = p.category ? p.category.name : 'No category';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push({
      name: p.name,
      id: p.id,
      price: p.price,
      w: p.tileWidth,
      h: p.tileHeight,
      desc: p.description ? p.description.substring(0, 80) : ''
    });
  });

  Object.entries(cats).forEach(([cat, prods]) => {
    console.log('\n=== ' + cat + ' (' + prods.length + ' products) ===');
    prods.forEach(p => {
      console.log('  ' + p.name + ' | ' + (p.w || '?') + 'x' + (p.h || '?') + 'cm | price: ' + (p.price || 'null') + ' | ' + p.desc);
    });
  });

  console.log('\n\nTOTAL: ' + products.length + ' products');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
