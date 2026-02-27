import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/auth";
import { uploadToS3, buildS3Key } from "@/lib/s3";
import sharp from "sharp";

type DetectedCategory = "flisar" | "parket" | "vinyl" | "annad";

interface ImportProduct {
  name: string;
  price: number | null;
  unit: string;
  imageUrl: string | null;
  surfaceTypes: string[];
  tileWidth: number | null;
  tileHeight: number | null;
  tileThickness: number | null;
  discountPercent: number | null;
  description: string | null;
  color: string | null;
  detectedCategory?: DetectedCategory;
}

/** Default category definitions */
const DEFAULT_CATEGORIES: Record<DetectedCategory, { name: string; surfaceType: string }> = {
  flisar: { name: "Flísar", surfaceType: "both" },
  parket: { name: "Parket", surfaceType: "floor" },
  vinyl: { name: "Vinyl", surfaceType: "floor" },
  annad: { name: "Annað", surfaceType: "floor" },
};

interface ImportResult {
  name: string;
  success: boolean;
  error?: string;
}

/** Download image from remote URL with realistic headers */
async function downloadImage(url: string, referer: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Referer": referer,
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Validate it's actually an image (at least a few KB)
    if (buffer.length < 500) return null;

    return buffer;
  } catch {
    return null;
  }
}

/** Process image: resize + convert to webp */
async function processImage(buffer: Buffer): Promise<{ data: Buffer; contentType: string }> {
  const processed = await sharp(buffer)
    .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  return { data: processed, contentType: "image/webp" };
}

/** Process products with concurrency limit */
async function processWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function next(): Promise<void> {
    const currentIndex = index++;
    if (currentIndex >= items.length) return;
    results[currentIndex] = await fn(items[currentIndex], currentIndex);
    await next();
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const body = await request.json();
    const { companyId, categoryId, products, sourceUrl } = body as {
      companyId: string;
      categoryId?: string;
      products: ImportProduct[];
      sourceUrl?: string;
    };

    if (!companyId || !products || !Array.isArray(products)) {
      return NextResponse.json(
        { error: "companyId and products array are required" },
        { status: 400 }
      );
    }

    // Validate company exists
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ error: "Fyrirtæki finnst ekki" }, { status: 404 });
    }

    // If a specific categoryId is provided, validate it
    let fixedCategoryId: string | null = null;
    if (categoryId) {
      const category = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!category || category.companyId !== companyId) {
        return NextResponse.json({ error: "Flokkur finnst ekki" }, { status: 404 });
      }
      fixedCategoryId = categoryId;
    }

    // Auto-create categories as needed (cache created category IDs)
    const categoryCache: Record<string, string> = {};

    async function getOrCreateCategory(detected: DetectedCategory): Promise<string> {
      // If a fixed categoryId was provided, always use that
      if (fixedCategoryId) return fixedCategoryId;

      // Check cache first
      if (categoryCache[detected]) return categoryCache[detected];

      const def = DEFAULT_CATEGORIES[detected];

      // Look for existing category with matching name for this company
      let existing = await prisma.category.findFirst({
        where: { companyId, name: def.name },
      });

      if (!existing) {
        // Get max sortOrder for categories
        const maxCatSort = await prisma.category.aggregate({
          where: { companyId },
          _max: { sortOrder: true },
        });
        const nextCatSort = (maxCatSort._max.sortOrder || 0) + 1;

        existing = await prisma.category.create({
          data: {
            companyId,
            name: def.name,
            surfaceType: def.surfaceType,
            sortOrder: nextCatSort,
          },
        });
      }

      categoryCache[detected] = existing.id;
      return existing.id;
    }

    // Get current max sortOrder for products
    const maxSort = await prisma.product.aggregate({
      where: { companyId },
      _max: { sortOrder: true },
    });
    let nextSortOrder = (maxSort._max.sortOrder || 0) + 1;

    const referer = sourceUrl || `https://${company.slug}.is`;

    // Process each product with concurrency limit of 5
    const results = await processWithConcurrency<ImportProduct, ImportResult>(
      products,
      5,
      async (product, _idx) => {
        try {
          // Resolve the category for this product
          const productCategoryId = await getOrCreateCategory(
            product.detectedCategory || "annad"
          );

          let imageUrl = "";

          // Download and process image
          if (product.imageUrl) {
            const imageBuffer = await downloadImage(product.imageUrl, referer);
            if (imageBuffer) {
              try {
                const { data, contentType } = await processImage(imageBuffer);
                const safeName = product.name
                  .replace(/[^a-zA-Z0-9\-_.áéíóúýþæðöÁÉÍÓÚÝÞÆÐÖ]/g, "-")
                  .replace(/-+/g, "-")
                  .slice(0, 60);
                const key = buildS3Key(companyId, "products", `${Date.now()}-${safeName}.webp`);
                imageUrl = await uploadToS3(key, data, contentType);
              } catch {
                // Sharp failed — try uploading the original
                const ext = product.imageUrl.split(".").pop()?.split("?")[0] || "jpg";
                const safeName = product.name.replace(/[^a-zA-Z0-9\-_.]/g, "-").slice(0, 60);
                const key = buildS3Key(companyId, "products", `${Date.now()}-${safeName}.${ext}`);
                imageUrl = await uploadToS3(key, imageBuffer, "image/jpeg");
              }
            }
          }

          // If no image could be downloaded, use a placeholder
          if (!imageUrl) {
            imageUrl = "/placeholder-product.png";
          }

          // Build description with color info
          let description = product.description || null;
          if (product.color && !description?.includes(product.color)) {
            description = product.color + (description ? ` — ${description}` : "");
          }

          // Create product
          await prisma.product.create({
            data: {
              companyId,
              categoryId: productCategoryId,
              name: product.name,
              description,
              price: product.price,
              unit: product.unit || "m2",
              imageUrl,
              surfaceTypes: product.surfaceTypes || ["floor"],
              tileWidth: product.tileWidth,
              tileHeight: product.tileHeight,
              tileThickness: product.tileThickness,
              discountPercent: product.discountPercent,
              sortOrder: nextSortOrder++,
            },
          });

          return { name: product.name, success: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          return { name: product.name, success: false, error: msg };
        }
      }
    );

    const imported = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const errors = results.filter(r => !r.success).map(r => ({ name: r.name, error: r.error || "Unknown" }));

    return NextResponse.json({
      imported,
      failed,
      errors,
      total: products.length,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Import products error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
