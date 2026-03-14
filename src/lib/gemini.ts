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

    // Resize Gemini output to match original room dimensions
    const generatedMeta = await sharp(generatedImageBuffer).metadata();
    console.log(`[Gemini] Generated image: ${generatedMeta.width}x${generatedMeta.height} → resizing to ${originalWidth}x${originalHeight}`);

    const resizedBuffer = await sharp(generatedImageBuffer)
      .resize(originalWidth, originalHeight, { fit: "fill" })
      .png({ quality: 95 })
      .toBuffer();

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
      `# STRICT IMAGE EDITING — FLOOR REPLACEMENT ONLY`,
      ``,
      `You are a PHOTO EDITOR performing a SURGICAL edit on an existing photograph. You MUST return the EXACT SAME photograph with ONLY the floor material swapped. This is NOT image generation — it is INPAINTING.`,
      ``,
      `## ⚠️ CRITICAL RULE — DO NOT REGENERATE THE ROOM ⚠️`,
      `You MUST preserve the EXACT room from Image 1. If your output shows a DIFFERENT room, different furniture, different layout, different walls, or different perspective — YOU HAVE FAILED.`,
      ``,
      `FORBIDDEN actions (violating ANY of these = failure):`,
      `- ❌ Generating a new room or a "similar-looking" room — KEEP THE EXACT ROOM from Image 1`,
      `- ❌ Changing, moving, removing, adding, or resizing ANY furniture or object`,
      `- ❌ Changing wall color, wall texture, wall material, or wall appearance in any way`,
      `- ❌ Changing the ceiling, doors, windows, cabinets, or any architectural element`,
      `- ❌ Changing camera angle, perspective, field of view, or composition`,
      `- ❌ Changing lighting, shadows, color temperature, white balance, or exposure`,
      `- ❌ Adding or removing any objects, people, pets, plants, or decorations`,
      `- ❌ Changing the style, era, or aesthetic of the room`,
      ``,
      `REQUIRED: Every pixel that is NOT floor must be IDENTICAL to Image 1. The room layout, furniture positions, wall colors, objects, lighting — ALL must match Image 1 exactly.`,
      ``,
      `## INPUT`,
      `- IMAGE 1 (FIRST IMAGE): The room photograph to edit — ${width}x${height} pixels. THIS is the room you must preserve.`,
      `- IMAGE 2 (SECOND IMAGE): Material/texture swatch "${productName}" — the new floor material to apply.`,
      opts?.productDescription ? `- Product info: "${opts.productDescription}"` : ``,
      ``,
      `## TASK`,
      `Take Image 1 and replace ONLY the visible floor surface with the material texture from Image 2. Return the SAME photo with the new floor. Nothing else changes.`,
      ``,
      `${sizeInstruction}`,
      ``,
      `## ALLOWED CHANGES (absolutely nothing else)`,
      `1. Floor surface pixels → replace with material texture from Image 2`,
      `2. Baseboard color → may adjust to complement new floor (shape/size stay identical)`,
      ``,
      `## NEVER CHANGE (keep pixel-identical to Image 1)`,
      `Walls, wall color, wall material, ceiling, furniture (every piece), appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor items, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboard shape/position, room layout, camera angle, perspective, focal length, lighting direction, shadow positions, color temperature, exposure level.`,
      ``,
      `## FLOOR MATERIAL RENDERING`,
      `- Match the EXACT color and texture of Image 2 — do NOT invent colors or shift the hue`,
      `- Identify material type: wood planks, ceramic tiles, stone, vinyl, etc.`,
      `- Render with appropriate joints/grout lines for the material type`,
      `- Tile seamlessly — no visible repetition patterns or mirror artifacts`,
      dimensionInfo
        ? `- EXACT DIMENSIONS: ${dimensionInfo}`
        : `- Scale realistically: tiles ~30-60cm, wood planks ~10-20cm wide × 60-200cm long`,
      ``,
      `## LAYING PATTERN`,
      `${patternInstruction}`,
      ``,
      `## PERSPECTIVE & BOUNDARIES`,
      `- Floor material follows the room's vanishing point(s) with proper foreshortening`,
      `- Floor stops exactly at the wall boundary — clean edge`,
      `- Clean transitions where floor meets furniture legs and objects`,
      ``,
      `## LIGHTING ON FLOOR`,
      `- Keep existing shadows from furniture/objects on the new floor`,
      `- Apply reflections appropriate to material finish (matte vs glossy)`,
      `- Match floor brightness to rest of room`,
      ``,
      `## OUTPUT`,
      `A single photorealistic image at ${width}x${height} pixels. No text, labels, or watermarks. The IDENTICAL room from Image 1 with ONLY the floor material changed to match Image 2.`,
    ].filter(Boolean).join("\n");
  }

  return [
    `# STRICT IMAGE EDITING — WALL REPLACEMENT ONLY`,
    ``,
    `You are a PHOTO EDITOR performing a SURGICAL edit on an existing photograph. You MUST return the EXACT SAME photograph with ONLY the wall material swapped. This is NOT image generation — it is INPAINTING.`,
    ``,
    `## ⚠️ CRITICAL RULE — DO NOT REGENERATE THE ROOM ⚠️`,
    `You MUST preserve the EXACT room from Image 1. If your output shows a DIFFERENT room, different furniture, different layout, different floor, or different perspective — YOU HAVE FAILED.`,
    ``,
    `FORBIDDEN actions (violating ANY of these = failure):`,
    `- ❌ Generating a new room or a "similar-looking" room — KEEP THE EXACT ROOM from Image 1`,
    `- ❌ Changing, moving, removing, adding, or resizing ANY furniture or object`,
    `- ❌ Changing floor color, floor texture, floor material, or floor appearance in any way`,
    `- ❌ Changing the ceiling, doors, windows, cabinets, or any architectural element`,
    `- ❌ Changing camera angle, perspective, field of view, or composition`,
    `- ❌ Changing lighting, shadows, color temperature, white balance, or exposure`,
    `- ❌ Adding or removing any objects, people, pets, plants, or decorations`,
    `- ❌ Changing the style, era, or aesthetic of the room`,
    ``,
    `REQUIRED: Every pixel that is NOT a wall surface must be IDENTICAL to Image 1. The room layout, furniture positions, floor material, objects, lighting — ALL must match Image 1 exactly.`,
    ``,
    `## INPUT`,
    `- IMAGE 1 (FIRST IMAGE): The room photograph to edit — ${width}x${height} pixels. THIS is the room you must preserve.`,
    `- IMAGE 2 (SECOND IMAGE): Material/texture swatch "${productName}" — the new wall material to apply.`,
    opts?.productDescription ? `- Product info: "${opts.productDescription}"` : ``,
    ``,
    `## TASK`,
    `Take Image 1 and replace ONLY the visible wall surfaces with the material texture from Image 2. Return the SAME photo with the new walls. Nothing else changes.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `## ALLOWED CHANGES (absolutely nothing else)`,
    `1. Wall surface pixels → replace with material texture from Image 2`,
    ``,
    `## NEVER CHANGE (keep pixel-identical to Image 1)`,
    `Floor, floor material, floor color, ceiling, furniture (every piece), appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor items, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboards (keep EXACTLY as in Image 1), room layout, camera angle, perspective, focal length, lighting direction, shadow positions, color temperature, exposure level.`,
    ``,
    `## WALL MATERIAL RENDERING`,
    `- Match the EXACT color and texture of Image 2 — do NOT invent colors or shift the hue`,
    `- Identify material type: ceramic tiles, stone, paint, wood panels, wallpaper, etc.`,
    `- Render with appropriate joints/grout lines for the material type`,
    `- Tile seamlessly — no visible repetition patterns or mirror artifacts`,
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
    `- Keep baseboards EXACTLY as in Image 1 — same color, shape, material, position`,
    `- Clean material edge at wall corners`,
    ``,
    `## PERSPECTIVE & LIGHTING`,
    `- Wall material follows each wall's flat geometry (side walls converge to vanishing point)`,
    `- Preserve existing shadow patterns and light gradients on walls`,
    `- Match surface finish: glossy → specular highlights, matte → absorb light`,
    ``,
    `## OUTPUT`,
    `A single photorealistic image at ${width}x${height} pixels. No text, labels, or watermarks. The IDENTICAL room from Image 1 with ONLY the wall material changed to match Image 2.`,
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
    `# STRICT IMAGE EDITING — FLOOR AND WALL REPLACEMENT ONLY`,
    ``,
    `You are a PHOTO EDITOR performing a SURGICAL edit on an existing photograph. You MUST return the EXACT SAME photograph with ONLY the floor and wall materials swapped. This is NOT image generation — it is INPAINTING.`,
    ``,
    `## ⚠️ CRITICAL RULE — DO NOT REGENERATE THE ROOM ⚠️`,
    `You MUST preserve the EXACT room from Image 1. If your output shows a DIFFERENT room, different furniture, different layout, or different perspective — YOU HAVE FAILED.`,
    ``,
    `FORBIDDEN actions (violating ANY of these = failure):`,
    `- ❌ Generating a new room or a "similar-looking" room — KEEP THE EXACT ROOM from Image 1`,
    `- ❌ Changing, moving, removing, adding, or resizing ANY furniture or object`,
    `- ❌ Changing the ceiling, doors, windows, cabinets, or any architectural element`,
    `- ❌ Changing camera angle, perspective, field of view, or composition`,
    `- ❌ Changing lighting, shadows, color temperature, white balance, or exposure`,
    `- ❌ Adding or removing any objects, people, pets, plants, or decorations`,
    `- ❌ Changing the style, era, or aesthetic of the room`,
    ``,
    `REQUIRED: Every pixel that is NOT floor or wall must be IDENTICAL to Image 1. The room layout, furniture positions, ceiling, objects, lighting — ALL must match Image 1 exactly.`,
    ``,
    `## INPUT`,
    `- IMAGE 1 (FIRST IMAGE): The room photograph to edit — ${width}x${height} pixels. THIS is the room you must preserve.`,
    `- IMAGE 2 (SECOND IMAGE): Floor material swatch "${floorProductName}" — the new floor material.`,
    opts?.floorProductDescription ? `  Floor product info: "${opts.floorProductDescription}"` : ``,
    `- IMAGE 3 (THIRD IMAGE): Wall material swatch "${wallProductName}" — the new wall material.`,
    opts?.wallProductDescription ? `  Wall product info: "${opts.wallProductDescription}"` : ``,
    ``,
    `## TASK`,
    `Take Image 1 and replace ONLY the floor with Image 2 material AND walls with Image 3 material. Return the SAME photo with new surfaces. Nothing else changes.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `## ALLOWED CHANGES (absolutely nothing else)`,
    `1. Floor surface pixels → replace with material texture from Image 2`,
    `2. Wall surface pixels → replace with material texture from Image 3`,
    `3. Baseboard color → may adjust to complement new floor (shape/size stay identical)`,
    ``,
    `## NEVER CHANGE (keep pixel-identical to Image 1)`,
    `Ceiling, furniture (every piece), appliances, kitchen cabinets, countertops, tables, chairs, sofas, beds, rugs, decor items, curtains, windows, window frames, window sills, doors, door frames, radiators, outlets, switches, shelves, artwork, mirrors, plants, people, pets, lamps, light fixtures, baseboard shape/position, room layout, camera angle, perspective, focal length, lighting direction, shadow positions, color temperature, exposure level.`,
    ``,
    `## FLOOR MATERIAL (Image 2: "${floorProductName}")`,
    `- Match EXACT color and texture of Image 2 — do NOT invent colors or shift hue`,
    `- Render with correct texture, joints/grout for the material type`,
    `- Tile seamlessly — no visible repetition or mirror artifacts`,
    floorDim ? `- ${floorDim}` : `- Scale realistically: tiles ~30-60cm, planks ~10-20cm wide × 60-200cm long`,
    `- LAYING PATTERN: ${floorPattern}`,
    `- Floor stops where it meets the wall`,
    ``,
    `## WALL MATERIAL (Image 3: "${wallProductName}")`,
    `- Match EXACT color and texture of Image 3 — do NOT invent colors or shift hue`,
    `- Render with correct texture, joints/grout for the material type`,
    `- Tile seamlessly — no visible repetition or mirror artifacts`,
    wallDim ? `- ${wallDim}` : `- Scale realistically: wall tiles ~10-30cm × 30-60cm`,
    `- LAYING PATTERN: ${wallPattern}`,
    `- Replace ALL visible wall surfaces. Stop at ceiling, floor, door frames, window frames`,
    `- Do NOT cover outlets, switches, vents, shelves, artwork, mirrors`,
    ``,
    `## BASEBOARDS`,
    `- Keep shape/size/position EXACTLY as in Image 1`,
    `- May recolor to match new floor tone, but keep geometry identical`,
    ``,
    `## PERSPECTIVE & LIGHTING`,
    `- Floor follows room vanishing point(s) with proper foreshortening`,
    `- Wall material follows each wall's flat geometry`,
    `- Preserve existing shadows and light gradients on all surfaces`,
    `- Apply reflections appropriate to material finish`,
    ``,
    `## OUTPUT`,
    `A single photorealistic image at ${width}x${height} pixels. No text, labels, or watermarks. The IDENTICAL room from Image 1 with ONLY floor and wall materials changed.`,
  ].filter(Boolean).join("\n");
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
