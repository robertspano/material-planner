import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCompanyFromRequest } from "@/lib/tenant";
import { generateWithGemini } from "@/lib/gemini";

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    // Check generation limit
    if (company.generationsUsed >= company.monthlyGenerationLimit) {
      return NextResponse.json(
        { error: "Monthly generation limit reached." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { surfaceType, productId, pattern } = body;
    // "both" mode: wallProductId + wallPattern for the wall product
    const wallProductId = body.wallProductId as string | undefined;
    const wallPattern = body.wallPattern as string | undefined;
    // batchId groups all generations from one "Generate" button press
    const batchId = body.batchId as string | undefined;
    // Accept generationId (new) or roomImageUrl (backward compat)
    const generationId = body.generationId as string | undefined;
    const roomImageUrl = body.roomImageUrl as string | undefined;

    if (!surfaceType || !productId) {
      return NextResponse.json(
        { error: "surfaceType and productId are required" },
        { status: 400 }
      );
    }

    if (surfaceType === "both" && !wallProductId) {
      return NextResponse.json(
        { error: "wallProductId is required when surfaceType is 'both'" },
        { status: 400 }
      );
    }

    // Fetch the floor product (or single product for floor/wall mode)
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || product.companyId !== company.id) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Fetch wall product if "both" mode
    let wallProduct = null;
    if (surfaceType === "both" && wallProductId) {
      wallProduct = await prisma.product.findUnique({
        where: { id: wallProductId },
      });
      if (!wallProduct || wallProduct.companyId !== company.id) {
        return NextResponse.json({ error: "Wall product not found" }, { status: 404 });
      }
    }

    // Resolve generation record — always create a fresh one per surface request
    // to avoid race conditions when floor + wall share the same generationId
    let generation;

    if (generationId) {
      // Look up the source generation (created at upload time)
      const sourceGen = await prisma.generation.findUnique({
        where: { id: generationId },
      });
      if (!sourceGen || sourceGen.companyId !== company.id) {
        return NextResponse.json({ error: "Generation not found" }, { status: 404 });
      }

      // Always create a NEW generation for each surface request
      // This prevents the race condition where floor + wall share one generationId
      generation = await prisma.generation.create({
        data: {
          companyId: company.id,
          sessionId: sourceGen.sessionId,
          batchId: batchId || null,
          roomImageUrl: sourceGen.roomImageUrl,
          status: "generating",
        },
      });
    } else if (roomImageUrl) {
      // Backward compat: always create fresh
      generation = await prisma.generation.create({
        data: {
          companyId: company.id,
          sessionId: crypto.randomUUID(),
          batchId: batchId || null,
          roomImageUrl,
          status: "generating",
        },
      });
    } else {
      return NextResponse.json(
        { error: "generationId or roomImageUrl is required" },
        { status: 400 }
      );
    }

    // Create product association(s)
    await prisma.generationProduct.create({
      data: {
        generationId: generation.id,
        productId: product.id,
        surfaceType: surfaceType === "both" ? "floor" : surfaceType,
      },
    }).catch(() => { /* Ignore duplicate */ });

    if (wallProduct) {
      await prisma.generationProduct.create({
        data: {
          generationId: generation.id,
          productId: wallProduct.id,
          surfaceType: "wall",
        },
      }).catch(() => { /* Ignore duplicate */ });
    }

    // Increment usage counter
    await prisma.company.update({
      where: { id: company.id },
      data: { generationsUsed: { increment: 1 } },
    });

    // Run Gemini generation asynchronously
    generateWithGemini({
      roomImageUrl: generation.roomImageUrl,
      productImageUrl: product.swatchUrl || product.imageUrl,
      productName: product.name,
      surfaceType: surfaceType as "floor" | "wall" | "both",
      generationId: generation.id,
      companyId: company.id,
      tileWidth: product.tileWidth,
      tileHeight: product.tileHeight,
      pattern: pattern || "straight",
      productDescription: product.description,
      // Wall product info for "both" mode
      ...(wallProduct ? {
        wallProductImageUrl: wallProduct.swatchUrl || wallProduct.imageUrl,
        wallProductName: wallProduct.name,
        wallTileWidth: wallProduct.tileWidth,
        wallTileHeight: wallProduct.tileHeight,
        wallPattern: wallPattern || "straight",
        wallProductDescription: wallProduct.description,
      } : {}),
    }).catch((err) => {
      console.error("Generation failed:", err);
    });

    return NextResponse.json({
      generationId: generation.id,
      status: "generating",
    });
  } catch (err) {
    console.error("Generate endpoint error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
