import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import { prisma } from "./prisma";
import { uploadToS3, buildS3Key } from "./s3";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// ---------------------------------------------------------------------------
// Global generation queue — ensures we never exceed Gemini rate limits.
// When multiple customers generate at the same time, requests are queued
// instead of hitting 429 errors.  No request is ever dropped — just delayed.
// ---------------------------------------------------------------------------
class GenerationQueue {
  private running = 0;
  private waiting: Array<{ resolve: () => void }> = [];
  private rateLimitPauseUntil = 0; // timestamp — pause all new calls until this time

  constructor(private maxConcurrent: number) {}

  async acquire(): Promise<void> {
    // If we're in a rate-limit cooldown, wait it out first
    const now = Date.now();
    if (this.rateLimitPauseUntil > now) {
      const waitMs = this.rateLimitPauseUntil - now;
      console.log(`[Queue] Rate-limit cooldown — waiting ${Math.round(waitMs / 1000)}s before next call`);
      await new Promise(r => setTimeout(r, waitMs));
    }

    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }

    // Queue is full — wait for a slot to open
    console.log(`[Queue] All ${this.maxConcurrent} slots busy — request queued (${this.waiting.length + 1} waiting)`);
    return new Promise(resolve => {
      this.waiting.push({ resolve });
    });
  }

  release(): void {
    this.running--;
    const next = this.waiting.shift();
    if (next) {
      this.running++;
      next.resolve();
    }
  }

  /** Called when Gemini returns 429 — pauses all new requests for a cooldown period */
  triggerRateLimitPause(seconds: number): void {
    this.rateLimitPauseUntil = Date.now() + seconds * 1000;
    console.log(`[Queue] Rate limit hit — pausing queue for ${seconds}s`);
  }

  get stats() {
    return { running: this.running, waiting: this.waiting.length };
  }
}

// Default: 8 concurrent image generations across all planners.
// Tier 1 Google AI allows ~10 IPM (images/min), so 8 is a safe parallel limit.
// Each generation = 1 mask call (text model, no IPM) + 1 image call (counts IPM).
// Override with GEMINI_MAX_CONCURRENT env var if you upgrade to Tier 2+.
const MAX_CONCURRENT = parseInt(process.env.GEMINI_MAX_CONCURRENT || "8", 10);
const geminiQueue = new GenerationQueue(MAX_CONCURRENT);

/**
 * Generate a room visualization using Gemini.
 *
 * Takes the room photo and a product photo, sends both to Gemini
 * with a precise prompt to replace only the selected surface (floor or wall)
 * with the product material, keeping everything else identical.
 */
export async function generateWithGemini(params: {
  roomImageUrl: string;
  productImageUrl: string;
  productName: string;
  surfaceType: "floor" | "wall" | "both";
  generationId: string;
  companyId: string;
  tileWidth?: number | null;
  tileHeight?: number | null;
  pattern?: string | null;
  productDescription?: string | null;
  // Additional product for "both" mode — wall product when surfaceType is "both"
  wallProductImageUrl?: string | null;
  wallProductName?: string | null;
  wallTileWidth?: number | null;
  wallTileHeight?: number | null;
  wallPattern?: string | null;
  wallProductDescription?: string | null;
}): Promise<string> {
  const { roomImageUrl, productImageUrl, productName, surfaceType, generationId, companyId, tileWidth, tileHeight, pattern, productDescription } = params;

  try {
    // Update status to "queued" while waiting for a slot
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "generating" },
    });

    // Pre-fetch images BEFORE acquiring a queue slot (no Gemini call needed)
    const imageFetches: Promise<{ base64: string; mimeType: string }>[] = [
      fetchImageAsBase64(roomImageUrl),
      fetchImageAsBase64(productImageUrl),
    ];
    // In "both" mode, also fetch the wall product image
    if (surfaceType === "both" && params.wallProductImageUrl) {
      imageFetches.push(fetchImageAsBase64(params.wallProductImageUrl));
    }
    const fetchedImages = await Promise.all(imageFetches);
    const roomImageData = fetchedImages[0];
    const productImageData = fetchedImages[1]; // floor product (or the only product)
    const wallProductImageData = fetchedImages[2] || null; // wall product (only in "both" mode)

    // Get original room image dimensions so we can resize the result to match
    const roomBuffer = Buffer.from(roomImageData.base64, "base64");
    const roomMeta = await sharp(roomBuffer).metadata();
    const originalWidth = roomMeta.width || 1024;
    const originalHeight = roomMeta.height || 768;
    console.log(`[Gemini] Room image dimensions: ${originalWidth}x${originalHeight}${surfaceType === "both" ? " (both surfaces)" : ""}`);

    // ---- START MASK GENERATION IN PARALLEL ----
    // Generates a B/W mask of the floor/wall surface so we can composite
    // the Gemini output onto the original image, preserving all non-surface areas.
    // This prevents Gemini from changing furniture, layout, colors, etc.
    const maskPromise = generateSurfaceMask(
      roomImageData,
      surfaceType as "floor" | "wall" | "both",
      originalWidth,
      originalHeight,
    ).catch((err: Error) => {
      console.warn("[Gemini] Mask generation failed, compositing will be skipped:", err.message);
      return null as Buffer | null;
    });

    const model = genAI.getGenerativeModel({
      model: "gemini-3-pro-image-preview",
      generationConfig: {
        // @ts-expect-error - responseModalities is supported but not in types yet
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    const prompt = surfaceType === "both"
      ? buildBothPrompt(productName, params.wallProductName || productName, originalWidth, originalHeight, {
          floorTileWidth: tileWidth, floorTileHeight: tileHeight, floorPattern: pattern,
          floorProductDescription: productDescription,
          wallTileWidth: params.wallTileWidth, wallTileHeight: params.wallTileHeight,
          wallPattern: params.wallPattern, wallProductDescription: params.wallProductDescription,
        })
      : buildPrompt(surfaceType, productName, originalWidth, originalHeight, { tileWidth, tileHeight, pattern, productDescription });

    // ---- QUEUE: wait for a slot before calling Gemini ----
    await geminiQueue.acquire();
    const { running, waiting } = geminiQueue.stats;
    console.log(`[Queue] Slot acquired for ${generationId.slice(0, 8)}… (${running} running, ${waiting} waiting)`);

    let generatedImageBuffer: Buffer;
    try {
      // Call Gemini with retry logic — if 429, pause the whole queue
      generatedImageBuffer = await withRetry(async () => {
        // Build content array: prompt + room image + product image(s)
        const contentParts: Parameters<typeof model.generateContent>[0] = [
          prompt,
          {
            inlineData: {
              mimeType: roomImageData.mimeType,
              data: roomImageData.base64,
            },
          },
          {
            inlineData: {
              mimeType: productImageData.mimeType,
              data: productImageData.base64,
            },
          },
        ];
        // In "both" mode, add the wall product as a third image
        if (wallProductImageData) {
          contentParts.push({
            inlineData: {
              mimeType: wallProductImageData.mimeType,
              data: wallProductImageData.base64,
            },
          });
        }

        const result = await model.generateContent(contentParts);

        const response = result.response;

        // Extract the generated image from the response
        let imageBuffer: Buffer | null = null;

        for (const candidate of response.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            if (part.inlineData) {
              imageBuffer = Buffer.from(part.inlineData.data, "base64");
              break;
            }
          }
          if (imageBuffer) break;
        }

        if (!imageBuffer) {
          throw new Error("Gemini did not return an image");
        }
        return imageBuffer;
      }, { label: "geminiGenerate", maxRetries: 3, baseDelay: 3000, onRateLimit: (retryAfter) => geminiQueue.triggerRateLimitPause(retryAfter) });
    } finally {
      // ALWAYS release the slot, even on failure
      geminiQueue.release();
    }

    // ---- WAIT FOR MASK AND COMPOSITE ----
    // Instead of just resizing, we composite the generated floor/wall onto the
    // original image using the mask. This ensures furniture, walls, layout etc.
    // stay IDENTICAL to the original — only the surface material changes.
    const maskBuffer = await maskPromise;

    const generatedMeta = await sharp(generatedImageBuffer).metadata();
    console.log(`[Gemini] Generated image: ${generatedMeta.width}x${generatedMeta.height}`);

    let resizedBuffer: Buffer;
    if (maskBuffer) {
      console.log(`[Gemini] Compositing with surface mask → preserving room identity`);
      resizedBuffer = await compositeWithMask(
        roomBuffer,
        generatedImageBuffer,
        maskBuffer,
        originalWidth,
        originalHeight,
      );
    } else {
      console.log(`[Gemini] No mask available → using raw Gemini output (resizing to ${originalWidth}x${originalHeight})`);
      resizedBuffer = await sharp(generatedImageBuffer)
        .resize(originalWidth, originalHeight, {
          fit: "fill",
        })
        .png({ quality: 95 })
        .toBuffer();
    }

    // Save the generated image (Cloudinary if configured, otherwise S3)
    let savedUrl: string;
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      const { uploadToCloudinary } = await import("./cloudinary");
      const filename = `${generationId}-${surfaceType}-${Date.now()}.png`;
      savedUrl = await uploadToCloudinary(resizedBuffer, filename, "planner-results");
    } else {
      const key = buildS3Key(companyId, "results", `${generationId}-${surfaceType}-${Date.now()}.png`);
      savedUrl = await uploadToS3(key, resizedBuffer, "image/png");
    }

    // Create result record
    await prisma.generationResult.create({
      data: {
        generationId,
        imageUrl: savedUrl,
        surfaceType,
      },
    });

    // Mark as completed
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "completed" },
    });

    return savedUrl;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Generation failed";
    const errCause = error instanceof Error && error.cause ? ` | Cause: ${String(error.cause)}` : "";
    console.error("Gemini generation error:", errMsg + errCause, error);
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: (errMsg + errCause).substring(0, 500),
      },
    });
    throw error;
  }
}

/**
 * Build the system prompt for Gemini.
 * This is the key to getting great results - very specific instructions.
 */
function buildPrompt(
  surfaceType: "floor" | "wall",
  productName: string,
  width: number,
  height: number,
  opts?: {
    tileWidth?: number | null;
    tileHeight?: number | null;
    pattern?: string | null;
    productDescription?: string | null;
  }
): string {
  const sizeInstruction = `IMAGE SIZE REQUIREMENT: The output image MUST be exactly ${width}x${height} pixels — the SAME dimensions and aspect ratio as Image 1. Do NOT crop, pad, or change the aspect ratio.`;

  // Build dimension info from real product data or fall back to generic
  const tw = opts?.tileWidth;
  const th = opts?.tileHeight;
  const dimensionInfo = tw && th
    ? `The exact tile/plank size is ${tw}×${th} cm. Render at this exact real-world scale — each tile/plank must appear as ${tw}cm wide and ${th}cm tall when seen face-on.`
    : null;

  // Build pattern instruction
  const patternMap: Record<string, string> = {
    straight: "STRAIGHT/GRID pattern — tiles aligned in a regular grid, edges perfectly parallel to walls. Grout lines form a uniform grid.",
    brick: "RUNNING BOND (brick) pattern — each row is offset by exactly half a tile width from the row above/below, like brickwork. Stagger is consistent.",
    herringbone: "HERRINGBONE pattern — rectangular tiles placed at alternating 90° angles forming a continuous V/zigzag pattern. Each tile's short end meets the long side of the next tile.",
    diagonal: "DIAGONAL (45°) pattern — tiles rotated 45° relative to the walls, so grout lines run at 45° angles. Tiles along walls are cut into triangles.",
    chevron: "CHEVRON pattern — tiles are cut at an angle and arranged in a V-shape pointing in one direction. Unlike herringbone, the ends form a clean straight line.",
    stacked: "STACKED VERTICAL pattern — tiles aligned in straight vertical columns with no horizontal offset. All vertical and horizontal grout lines are continuous.",
    "one-third": "1/3 OFFSET pattern — each row is offset by exactly one-third of the tile width, creating a staggered pattern with more subtle offset than brick bond.",
  };
  const patternKey = opts?.pattern || "straight";
  const patternInstruction = patternMap[patternKey] || patternMap.straight;

  if (surfaceType === "floor") {
    return [
      `You are an image EDITING tool. You do NOT generate new images. You EDIT the provided photograph by replacing ONLY the floor surface material. This is an INPAINTING task.`,
      ``,
      `## RULE #1 — IDENTITY PRESERVATION (MOST IMPORTANT RULE)`,
      `This is NOT image generation. You are EDITING Image 1. The output must be the SAME photograph with ONLY the floor pixels changed.`,
      `- The room structure, walls, ceiling, furniture, appliances, objects, doors, windows, cabinets, shelves — ALL must be IDENTICAL to Image 1`,
      `- Do NOT reimagine, redesign, rearrange, or regenerate the room`,
      `- Do NOT change the wall color, wall material, or any wall appearance`,
      `- Do NOT move, remove, add, resize, reshape, or alter ANY object in the room`,
      `- Do NOT change lighting, shadows, color temperature, or exposure`,
      `- Every single pixel that is NOT floor surface must be copied EXACTLY from Image 1`,
      `- If you cannot preserve the room exactly, it is better to make minimal floor changes than to alter the room`,
      ``,
      `## INPUT`,
      `- IMAGE 1: The photograph to edit — ${width}x${height} pixels`,
      `- IMAGE 2: Material swatch "${productName}" to apply on the floor`,
      opts?.productDescription ? `- Product info: "${opts.productDescription}"` : ``,
      ``,
      `## TASK`,
      `Edit Image 1: replace ONLY the floor surface with the material shown in Image 2. Everything else stays EXACTLY the same.`,
      ``,
      `${sizeInstruction}`,
      ``,
      `## WHAT YOU MAY CHANGE (nothing else)`,
      `- Floor surface → replace with material from Image 2`,
      `- Baseboard COLOR ONLY → recolor to match the new floor tone (keep shape/size identical)`,
      ``,
      `## WHAT YOU MUST NOT CHANGE (absolute)`,
      `Walls, ceiling, wall color, wall material, furniture, appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboards shape/size, room layout, camera angle, perspective, lighting. ALL of these must remain PIXEL-IDENTICAL to Image 1.`,
      ``,
      `## COLOR ACCURACY`,
      `- Floor color MUST EXACTLY match Image 2. Do NOT shift hue/saturation/brightness.`,
      `- Every tile/plank must be the SAME color as Image 2. No invented colors or random variation.`,
      `- Only lighting effects (shadows, reflections) may cause subtle variation — base color stays identical to Image 2.`,
      ``,
      `## FLOOR MATERIAL`,
      `- Identify material type from Image 2 (wood planks, ceramic tiles, stone, vinyl, etc.)`,
      `- Wood/parquet: render planks with grain matching Image 2, realistic joints, same color`,
      `- Tile/ceramic: render with proper grout lines, correct proportions, uniform color matching Image 2`,
      `- Stone/marble: render with veining matching Image 2, proper joints, same color`,
      `- Must tile seamlessly — no visible repetition or mirroring artifacts`,
      dimensionInfo
        ? `- EXACT DIMENSIONS: ${dimensionInfo}`
        : `- Scale realistically: tiles ~30-60cm, wood planks ~10-20cm wide × 60-200cm long`,
      ``,
      `## LAYING PATTERN`,
      `${patternInstruction}`,
      ``,
      `## BOUNDARIES`,
      `- Floor stops exactly where it meets the wall — clean boundary`,
      `- Baseboards: keep shape/size, ONLY recolor to match new floor tone`,
      `- Do NOT touch door frames, window frames, or any other trim`,
      ``,
      `## PERSPECTIVE`,
      `- Floor material follows the room's vanishing point(s)`,
      `- Tiles closer to camera appear larger (proper foreshortening)`,
      `- Clean transitions where floor meets furniture legs, walls, objects`,
      ``,
      `## LIGHTING`,
      `- Cast existing shadows from furniture onto new floor naturally`,
      `- Apply reflections appropriate to material finish`,
      `- Match brightness/exposure of floor area to rest of room`,
      ``,
      `## OUTPUT`,
      `A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks. The SAME room from Image 1 with ONLY the floor changed.`,
    ].filter(Boolean).join("\n");
  }

  return [
    `You are an image EDITING tool. You do NOT generate new images. You EDIT the provided photograph by replacing ONLY the wall surface materials. This is an INPAINTING task.`,
    ``,
    `## RULE #1 — IDENTITY PRESERVATION (MOST IMPORTANT RULE)`,
    `This is NOT image generation. You are EDITING Image 1. The output must be the SAME photograph with ONLY the wall pixels changed.`,
    `- The room structure, floor, ceiling, furniture, appliances, objects, doors, windows, cabinets, shelves — ALL must be IDENTICAL to Image 1`,
    `- Do NOT reimagine, redesign, rearrange, or regenerate the room`,
    `- Do NOT change the floor color, floor material, or any floor appearance`,
    `- Do NOT move, remove, add, resize, reshape, or alter ANY object in the room`,
    `- Do NOT change lighting, shadows, color temperature, or exposure`,
    `- Every single pixel that is NOT wall surface must be copied EXACTLY from Image 1`,
    `- If you cannot preserve the room exactly, it is better to make minimal wall changes than to alter the room`,
    ``,
    `## INPUT`,
    `- IMAGE 1: The photograph to edit — ${width}x${height} pixels`,
    `- IMAGE 2: Material swatch "${productName}" to apply on the walls`,
    opts?.productDescription ? `- Product info: "${opts.productDescription}"` : ``,
    ``,
    `## TASK`,
    `Edit Image 1: replace ONLY the wall surfaces with the material shown in Image 2. Everything else stays EXACTLY the same.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `## WHAT YOU MAY CHANGE (nothing else)`,
    `- Wall surfaces → replace with material from Image 2`,
    ``,
    `## WHAT YOU MUST NOT CHANGE (absolute)`,
    `Floor, floor material, floor color, ceiling, furniture, appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboards (keep EXACTLY as in Image 1 — same color, shape, material), room layout, camera angle, perspective, lighting. ALL of these must remain PIXEL-IDENTICAL to Image 1.`,
    ``,
    `## COLOR ACCURACY`,
    `- Wall color MUST EXACTLY match Image 2. Do NOT shift hue/saturation/brightness.`,
    `- Every tile/panel must be the SAME color as Image 2. No invented colors or random variation.`,
    `- Only lighting effects (shadows, reflections) may cause subtle variation — base color stays identical to Image 2.`,
    ``,
    `## WALL MATERIAL`,
    `- Identify material type from Image 2 (ceramic tiles, stone, paint, wood panels, wallpaper, etc.)`,
    `- Tile/ceramic: render with proper grout lines, correct dimensions, uniform color matching Image 2`,
    `- Stone/marble: render with veining matching Image 2, realistic depth, proper joints`,
    `- Wood panels: render with grain matching Image 2, proper panel joints, same color`,
    `- Solid/paint: apply uniformly matching Image 2's exact color and finish`,
    `- Must tile seamlessly — no visible repetition or mirroring artifacts`,
    dimensionInfo
      ? `- EXACT DIMENSIONS: ${dimensionInfo}`
      : `- Scale realistically: wall tiles ~10-30cm × 30-60cm`,
    ``,
    `## LAYING PATTERN`,
    `${patternInstruction}`,
    ``,
    `## BOUNDARIES`,
    `- Replace ALL visible wall surfaces`,
    `- Stop at: ceiling, floor, door frames, window frames, built-in fixtures`,
    `- Do NOT cover outlets, switches, vents, shelves, artwork, mirrors — they remain on top`,
    `- Baseboards: keep COMPLETELY unchanged — same color, shape, material as Image 1`,
    `- Do NOT touch door frames, window frames, or any other trim`,
    `- Clean material edge at wall corners`,
    ``,
    `## PERSPECTIVE`,
    `- Wall material follows each wall's flat geometry`,
    `- Side walls: material converges toward vanishing point`,
    `- Front walls: material appears face-on with minimal distortion`,
    `- Consistent material scale across all walls`,
    ``,
    `## LIGHTING`,
    `- Preserve existing shadow patterns on walls`,
    `- Apply gradients matching original (darker in corners, brighter near windows)`,
    `- Match surface finish: glossy → specular highlights, matte → absorb light`,
    ``,
    `## OUTPUT`,
    `A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks. The SAME room from Image 1 with ONLY the walls changed.`,
  ].filter(Boolean).join("\n");
}

/**
 * Build the prompt for "both" mode — replace floor AND walls in a single image.
 * Gemini receives 3 images: room, floor product, wall product.
 */
function buildBothPrompt(
  floorProductName: string,
  wallProductName: string,
  width: number,
  height: number,
  opts?: {
    floorTileWidth?: number | null;
    floorTileHeight?: number | null;
    floorPattern?: string | null;
    floorProductDescription?: string | null;
    wallTileWidth?: number | null;
    wallTileHeight?: number | null;
    wallPattern?: string | null;
    wallProductDescription?: string | null;
  }
): string {
  const sizeInstruction = `IMAGE SIZE REQUIREMENT: The output image MUST be exactly ${width}x${height} pixels — the SAME dimensions and aspect ratio as Image 1. Do NOT crop, pad, or change the aspect ratio.`;

  const patternMap: Record<string, string> = {
    straight: "STRAIGHT/GRID pattern — tiles aligned in a regular grid, edges perfectly parallel to walls.",
    brick: "RUNNING BOND (brick) pattern — each row offset by half a tile width, like brickwork.",
    herringbone: "HERRINGBONE pattern — rectangular tiles at alternating 90° angles forming V/zigzag.",
    diagonal: "DIAGONAL (45°) pattern — tiles rotated 45° relative to walls.",
    chevron: "CHEVRON pattern — tiles cut at an angle arranged in a V-shape.",
    stacked: "STACKED VERTICAL pattern — tiles aligned in straight vertical columns.",
    "one-third": "1/3 OFFSET pattern — each row offset by one-third of tile width.",
  };

  const floorPattern = patternMap[opts?.floorPattern || "straight"] || patternMap.straight;
  const wallPattern = patternMap[opts?.wallPattern || "straight"] || patternMap.straight;

  const floorDim = opts?.floorTileWidth && opts?.floorTileHeight
    ? `Exact floor tile/plank size: ${opts.floorTileWidth}×${opts.floorTileHeight} cm.`
    : null;
  const wallDim = opts?.wallTileWidth && opts?.wallTileHeight
    ? `Exact wall tile size: ${opts.wallTileWidth}×${opts.wallTileHeight} cm.`
    : null;

  return [
    `You are an image EDITING tool. You do NOT generate new images. You EDIT the provided photograph by replacing ONLY the floor and wall surface materials. This is an INPAINTING task.`,
    ``,
    `## RULE #1 — IDENTITY PRESERVATION (MOST IMPORTANT RULE)`,
    `This is NOT image generation. You are EDITING Image 1. The output must be the SAME photograph with ONLY floor and wall pixels changed.`,
    `- The room structure, ceiling, furniture, appliances, objects, doors, windows, cabinets, shelves — ALL must be IDENTICAL to Image 1`,
    `- Do NOT reimagine, redesign, rearrange, or regenerate the room`,
    `- Do NOT move, remove, add, resize, reshape, or alter ANY object in the room`,
    `- Do NOT change lighting, shadows, color temperature, or exposure`,
    `- Every single pixel that is NOT floor or wall surface must be copied EXACTLY from Image 1`,
    `- If you cannot preserve the room exactly, it is better to make minimal surface changes than to alter the room`,
    ``,
    `## INPUT`,
    `- IMAGE 1: The photograph to edit — ${width}x${height} pixels`,
    `- IMAGE 2: Floor material swatch "${floorProductName}"`,
    opts?.floorProductDescription ? `  Floor product info: "${opts.floorProductDescription}"` : ``,
    `- IMAGE 3: Wall material swatch "${wallProductName}"`,
    opts?.wallProductDescription ? `  Wall product info: "${opts.wallProductDescription}"` : ``,
    ``,
    `## TASK`,
    `Edit Image 1: replace ONLY the floor surface with Image 2 material AND wall surfaces with Image 3 material. Everything else stays EXACTLY the same.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `## WHAT YOU MAY CHANGE (nothing else)`,
    `- Floor surface → replace with material from Image 2`,
    `- Wall surfaces → replace with material from Image 3`,
    `- Baseboard COLOR ONLY → recolor to match the new floor tone (keep shape/size identical)`,
    ``,
    `## WHAT YOU MUST NOT CHANGE (absolute)`,
    `Ceiling, furniture, appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboards shape/size, room layout, camera angle, perspective, lighting. ALL of these must remain PIXEL-IDENTICAL to Image 1.`,
    ``,
    `## COLOR ACCURACY`,
    `- Floor color MUST EXACTLY match Image 2. Wall color MUST EXACTLY match Image 3.`,
    `- Do NOT shift hue/saturation/brightness of either material.`,
    `- Every tile/plank must match its source image. No invented colors or random variation.`,
    `- Only lighting effects (shadows, reflections) may cause subtle variation.`,
    ``,
    `## FLOOR MATERIAL (Image 2: "${floorProductName}")`,
    `- Identify material type from Image 2 (wood, ceramic, stone, vinyl, etc.)`,
    `- Render with correct texture, joints/grout, and uniform color matching Image 2`,
    `- Must tile seamlessly — no visible repetition or mirroring`,
    floorDim ? `- ${floorDim}` : `- Scale realistically: tiles ~30-60cm, planks ~10-20cm wide × 60-200cm long`,
    `- LAYING PATTERN: ${floorPattern}`,
    `- Floor stops where it meets the wall`,
    ``,
    `## WALL MATERIAL (Image 3: "${wallProductName}")`,
    `- Identify material type from Image 3 (ceramic, stone, wood, paint, wallpaper, etc.)`,
    `- Render with correct texture, joints/grout, and uniform color matching Image 3`,
    `- Must tile seamlessly — no visible repetition or mirroring`,
    wallDim ? `- ${wallDim}` : `- Scale realistically: wall tiles ~10-30cm × 30-60cm`,
    `- LAYING PATTERN: ${wallPattern}`,
    `- Replace ALL visible wall surfaces. Stop at ceiling, floor, door frames, window frames`,
    `- Do NOT cover outlets, switches, vents, shelves, artwork, mirrors`,
    ``,
    `## BASEBOARDS`,
    `- Keep shape/size/position EXACTLY as in Image 1 — do NOT remove`,
    `- ONLY recolor to match the dominant tone of the new floor material (Image 2)`,
    `- Do NOT touch door frames, window frames, or any other trim`,
    ``,
    `## PERSPECTIVE`,
    `- Floor material follows room vanishing point(s) — proper foreshortening`,
    `- Wall material follows each wall's flat geometry — side walls converge to vanishing point`,
    `- Consistent material scale across all surfaces`,
    ``,
    `## LIGHTING`,
    `- Cast existing shadows onto new surfaces naturally`,
    `- Preserve shadow patterns from furniture, window frames, etc.`,
    `- Apply reflections appropriate to material finish`,
    `- Match brightness/exposure to the rest of the room`,
    ``,
    `## OUTPUT`,
    `A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks. The SAME room from Image 1 with ONLY floor and walls changed.`,
  ].filter(Boolean).join("\n");
}

/**
 * Generate a segmentation mask for the floor/wall surfaces using Gemini.
 * Uses the text model to get polygon coordinates, then renders them as an SVG mask.
 * This runs in parallel with the main generation to avoid extra latency.
 * Returns a Buffer containing a B/W PNG mask (white = surface, black = keep).
 */
async function generateSurfaceMask(
  roomImageData: { base64: string; mimeType: string },
  surfaceType: "floor" | "wall" | "both",
  width: number,
  height: number,
): Promise<Buffer> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const surfaceDesc = surfaceType === "floor"
    ? "FLOOR surface only (the horizontal surface people walk on)"
    : surfaceType === "wall"
    ? "all visible WALL surfaces (vertical surfaces)"
    : "FLOOR surface AND all visible WALL surfaces";

  const prompt = [
    `Analyze this ${width}×${height} pixel room photograph. Output the POLYGON boundaries of the ${surfaceDesc}.`,
    ``,
    `For each surface area, output a polygon as an array of [x, y] coordinate pairs in PIXELS.`,
    `x ranges from 0 (left) to ${width - 1} (right). y ranges from 0 (top) to ${height - 1} (bottom).`,
    ``,
    `RULES:`,
    `- Trace the VISIBLE boundary of each surface precisely.`,
    `- Use 12-30 points per polygon to accurately follow edges and curves.`,
    `- Points go CLOCKWISE around each surface area.`,
    surfaceType === "floor"
      ? `- Include ONLY the floor. Exclude: furniture legs, rugs, mats, objects ON the floor, walls, doors.`
      : surfaceType === "wall"
      ? `- Include ONLY walls. Exclude: doors, door frames, windows, window frames, outlets, switches, shelves, artwork, mirrors, furniture against walls.`
      : `- Include floor AND walls as separate polygons. Exclude: doors, windows, furniture, ceiling, objects.`,
    `- If there are multiple disconnected areas of ${surfaceType === "floor" ? "floor" : "surface"}, output separate polygons for each.`,
    `- Be generous with the surface area — better to include slightly too much than too little.`,
    ``,
    `Output ONLY valid JSON:`,
    `{"polygons": [[[x1,y1],[x2,y2],[x3,y3],...], ...]}`,
  ].join("\n");

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: roomImageData.mimeType, data: roomImageData.base64 } },
  ]);

  const text = result.response.text().trim();
  let jsonStr = text;
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const data = JSON.parse(jsonStr);
  const polygons: number[][][] = data.polygons || [];

  if (polygons.length === 0) throw new Error("No surface polygons detected");

  // Create SVG mask from polygons
  const svgPolygons = polygons.map(poly => {
    const points = poly.map(([x, y]) => {
      const px = Math.max(0, Math.min(width, Math.round(x)));
      const py = Math.max(0, Math.min(height, Math.round(y)));
      return `${px},${py}`;
    }).join(" ");
    return `<polygon points="${points}" fill="white"/>`;
  }).join("\n    ");

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="black"/>
    ${svgPolygons}
  </svg>`
  );

  // Render SVG to PNG, then blur for smooth compositing edges
  const rawMask = await sharp(svg).png().toBuffer();
  return sharp(rawMask)
    .blur(8) // Gaussian blur for soft transitions at edges
    .toBuffer();
}

/**
 * Composite the generated image onto the original using a mask.
 * Where mask is white → use generated pixel (new floor/wall).
 * Where mask is black → use original pixel (furniture, walls, etc.).
 * The mask's blur creates smooth transitions at edges.
 */
async function compositeWithMask(
  originalBuffer: Buffer,
  generatedBuffer: Buffer,
  maskBuffer: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  // 1. Resize generated image to target dimensions (RGB, no alpha)
  const resizedGenerated = await sharp(generatedBuffer)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .toBuffer();

  // 2. Process mask: resize to match, ensure grayscale, normalize range, blur
  const processedMask = await sharp(maskBuffer)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .normalize() // stretch values to full 0-255 range
    .toBuffer();

  // 3. Add processed mask as alpha channel to the generated image
  //    alpha=255 (white mask) → generated pixel is opaque (floor/wall from Gemini)
  //    alpha=0 (black mask) → generated pixel is transparent (original shows through)
  const generatedWithAlpha = await sharp(resizedGenerated)
    .joinChannel(processedMask)
    .png()
    .toBuffer();

  // 4. Composite: generated (with mask as alpha) OVER original
  const result = await sharp(originalBuffer)
    .resize(width, height, { fit: "fill" })
    .composite([{
      input: generatedWithAlpha,
      blend: 'over',
    }])
    .png()
    .toBuffer();

  return result;
}

/**
 * Retry wrapper with exponential backoff and rate-limit awareness.
 * When a 429 is detected, calls onRateLimit to pause the global queue.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxRetries = 3,
    baseDelay = 2000,
    label = "operation",
    onRateLimit,
  }: {
    maxRetries?: number;
    baseDelay?: number;
    label?: string;
    onRateLimit?: (retryAfterSeconds: number) => void;
  } = {}
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const errMsg = lastError.message || "";

      // Detect rate limit (429) errors
      const isRateLimit = errMsg.includes("429") || errMsg.toLowerCase().includes("rate limit") || errMsg.toLowerCase().includes("resource exhausted");

      if (isRateLimit && onRateLimit) {
        // Try to parse retry-after from error, default to escalating backoff
        const retryAfter = attempt === 0 ? 15 : attempt === 1 ? 30 : 60;
        onRateLimit(retryAfter);
      }

      if (attempt < maxRetries) {
        // Rate limit errors get longer delays
        const delay = isRateLimit
          ? (attempt === 0 ? 15000 : 30000 + Math.random() * 5000)
          : baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.log(`[Gemini] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}. ${isRateLimit ? "Rate limited — " : ""}Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// In-memory cache for fetched images (avoids re-fetching the same room image 5 times)
const imageCache = new Map<string, { base64: string; mimeType: string }>();

/**
 * Fetch an image (local or remote) and convert to base64.
 * Includes caching and retry logic.
 */
async function fetchImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string }> {
  // Check cache first
  const cached = imageCache.get(imageUrl);
  if (cached) {
    console.log("[Gemini] Using cached image:", imageUrl.substring(0, 80));
    return cached;
  }

  // Handle local/relative paths — convert to full URL and fetch remotely
  // On Vercel, local filesystem is read-only so we can't use fs.readFile
  if (imageUrl.startsWith("/uploads/") || imageUrl.startsWith("/placeholder")) {
    // In production, these should be absolute URLs already.
    // If we still get relative paths, try reading locally (dev) or construct a fetchable URL
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      const filePath = path.join(process.cwd(), "public", imageUrl);
      const fileBuffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      const result = { base64: fileBuffer.toString("base64"), mimeType };
      imageCache.set(imageUrl, result);
      return result;
    } catch {
      // Filesystem not available (Vercel) — fall through to remote fetch
      // Construct full URL from NEXTAUTH_URL or VERCEL_URL
      const baseUrl = process.env.NEXTAUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
      imageUrl = `${baseUrl}${imageUrl}`;
      console.log("[Gemini] Local read failed, fetching via URL:", imageUrl.substring(0, 100));
    }
  }

  // Remote URL - fetch with timeout + retry
  const result = await withRetry(async () => {
    console.log("[Gemini] Fetching remote image:", imageUrl.substring(0, 100));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(imageUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const contentType = response.headers.get("content-type") || "image/jpeg";
      console.log("[Gemini] Fetched image:", buffer.length, "bytes,", contentType);
      return { base64: buffer.toString("base64"), mimeType: contentType };
    } finally {
      clearTimeout(timeout);
    }
  }, { label: "fetchImage", maxRetries: 2, baseDelay: 1500 });

  imageCache.set(imageUrl, result);
  // Clean cache after 5 minutes to avoid memory leaks
  setTimeout(() => imageCache.delete(imageUrl), 5 * 60 * 1000);
  return result;
}
