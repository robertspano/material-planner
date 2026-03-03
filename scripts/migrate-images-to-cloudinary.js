const { PrismaClient } = require("../src/generated/prisma");
const { v2: cloudinary } = require("cloudinary");
const path = require("path");
const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "dgrig52h7",
  api_key: process.env.CLOUDINARY_API_KEY || "845696139587831",
  api_secret: process.env.CLOUDINARY_API_SECRET || "gT1kOZmH7AC6ogKR9_Gk6C6hVl0",
});

const prisma = new PrismaClient();
const PUBLIC_DIR = path.join(__dirname, "..", "public");

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, imageUrl: true },
  });

  console.log(`Found ${products.length} products to process`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    // Skip if already a Cloudinary URL
    if (product.imageUrl.includes("cloudinary") || product.imageUrl.includes("res.cloudinary.com")) {
      skipped++;
      continue;
    }

    const localPath = path.join(PUBLIC_DIR, product.imageUrl);

    if (!fs.existsSync(localPath)) {
      console.log(`  SKIP (file not found): ${product.imageUrl}`);
      skipped++;
      continue;
    }

    try {
      const result = await cloudinary.uploader.upload(localPath, {
        folder: "material-planner/products",
        public_id: path.basename(product.imageUrl, path.extname(product.imageUrl)),
        overwrite: false,
        resource_type: "image",
      });

      await prisma.product.update({
        where: { id: product.id },
        data: { imageUrl: result.secure_url },
      });

      uploaded++;
      if (uploaded % 50 === 0) {
        console.log(`  Uploaded ${uploaded}/${products.length}...`);
      }
    } catch (err) {
      // If already exists on Cloudinary, get the URL
      if (err.http_code === 400 || err.error?.message?.includes("already exists")) {
        const publicId = `material-planner/products/${path.basename(product.imageUrl, path.extname(product.imageUrl))}`;
        try {
          const existing = await cloudinary.api.resource(publicId);
          await prisma.product.update({
            where: { id: product.id },
            data: { imageUrl: existing.secure_url },
          });
          uploaded++;
          continue;
        } catch (e) {
          // ignore
        }
      }
      console.log(`  FAIL: ${product.name} - ${err.message || err}`);
      failed++;
    }
  }

  console.log(`\nDone! Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
