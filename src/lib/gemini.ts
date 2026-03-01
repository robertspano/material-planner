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

// High default — all requests go to Gemini in parallel simultaneously.
// The queue only kicks in as a safety net when Gemini returns 429 (rate limit).
// Normal flow: 20 images → 20 parallel calls → all finish at ~same time (~30s).
// Overload flow: 429 detected → queue pauses → retries after cooldown.
const MAX_CONCURRENT = parseInt(process.env.GEMINI_MAX_CONCURRENT || "50", 10);
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

    // Resize the generated image to match the original room image dimensions
    const generatedMeta = await sharp(generatedImageBuffer).metadata();
    console.log(`[Gemini] Generated image: ${generatedMeta.width}x${generatedMeta.height} → resizing to ${originalWidth}x${originalHeight}`);

    const resizedBuffer = await sharp(generatedImageBuffer)
      .resize(originalWidth, originalHeight, {
        fit: "fill", // exact dimensions, no cropping
      })
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
      `You are a world-class architectural visualization engine specializing in photorealistic interior material replacement.`,
      ``,
      `INPUT:`,
      `- IMAGE 1: A photograph of a real room (the "source room") — dimensions: ${width}x${height} pixels`,
      `- IMAGE 2: A product material sample/swatch called "${productName}" (the "target material")`,
      opts?.productDescription ? `- Product description: "${opts.productDescription}"` : ``,
      ``,
      `TASK: Generate a single photorealistic image that is PIXEL-IDENTICAL to Image 1 in every way, EXCEPT the floor surface is replaced with the material from Image 2.`,
      ``,
      `${sizeInstruction}`,
      ``,
      `ABSOLUTE CONSTRAINTS (violating any of these = failure):`,
      `1. ONLY the floor surface and baseboard COLOR may change. EVERYTHING ELSE must be pixel-identical to Image 1.`,
      `2. DO NOT REMOVE, ALTER, or MODIFY: window frames, window sills, door frames, doors, baseboards (keep shape — only recolor), ceiling, furniture, rugs, decor, curtains, radiators, electrical outlets, light switches, shelves, artwork, mirrors, people, pets, plants.`,
      `3. Window frames and window sills MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape. Do NOT recolor or replace them.`,
      `4. Door frames MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape.`,
      `5. The camera angle, lens distortion, field of view, and perspective must be IDENTICAL to Image 1`,
      `6. Room geometry, proportions, and spatial layout must not change AT ALL`,
      `7. Lighting direction, intensity, color temperature, and ambient light must match Image 1 exactly`,
      `8. The output image MUST have the EXACT same dimensions (${width}x${height}px) and aspect ratio as Image 1`,
      ``,
      `COLOR ACCURACY (CRITICAL — THIS IS THE MOST IMPORTANT RULE):`,
      `- The floor material color MUST EXACTLY match the color shown in Image 2. Do NOT shift, reinterpret, or change the hue/saturation/brightness.`,
      `- If Image 2 is grey → the floor MUST be the exact same grey. If beige → exact same beige. If dark brown → exact same dark brown.`,
      `- Every single tile/plank must be the SAME color as Image 2. Do NOT invent new colors or tones.`,
      `- Analyze the dominant RGB color values in Image 2 and reproduce them faithfully on the floor.`,
      `- The ONLY acceptable color variation is from lighting effects (shadows, reflections) — the base material color stays identical to Image 2.`,
      ``,
      `FLOOR MATERIAL APPLICATION RULES:`,
      `- Study Image 2 carefully: identify the material type (wood planks, ceramic tiles, stone, vinyl, etc.)`,
      `- If it's WOOD/PARQUET: render individual planks with visible grain direction matching Image 2, realistic plank width and length proportions, and subtle gaps/joints between planks. All planks must be the SAME color/tone as Image 2.`,
      `- If it's TILE/CERAMIC: render with proper grout lines (thin, consistent width), correct tile dimensions and proportions. ALL tiles must be the SAME uniform color as shown in Image 2 — do NOT add random color variation between tiles.`,
      `- If it's STONE/MARBLE: render with natural veining patterns matching Image 2's pattern, realistic surface texture, and proper joint lines. Keep the SAME color as Image 2.`,
      `- The material MUST tile seamlessly — no visible repetition patterns, no obvious mirroring artifacts`,
      dimensionInfo
        ? `- EXACT DIMENSIONS: ${dimensionInfo}`
        : `- Scale the material realistically: standard floor tiles are roughly 30x30cm to 60x60cm, wood planks are roughly 10-20cm wide and 60-200cm long`,
      ``,
      `LAYING PATTERN (CRITICAL):`,
      `- The tiles/planks MUST be laid in the following pattern: ${patternInstruction}`,
      `- Follow this pattern precisely across the entire floor surface`,
      `- The pattern must be geometrically correct and consistent`,
      ``,
      `FLOOR BOUNDARIES & BASEBOARDS (CRITICAL — READ CAREFULLY):`,
      `- The new material covers the floor surface — stop exactly where the floor meets the wall`,
      `- BASEBOARDS / SKIRTING BOARDS (gólflístar — the small horizontal trim strips at the bottom of walls): These MUST REMAIN in the image. DO NOT REMOVE THEM. DO NOT ERASE THEM. They must stay exactly where they are with the same shape and size.`,
      `- ONLY change the COLOR of the baseboards to match the dominant color/tone of the new floor material from Image 2.`,
      `- If the new floor is dark wood → baseboards become matching dark tone. Light oak → light tone. Grey tile → matching grey/white.`,
      `- The baseboards must remain as solid painted wood strips (not tiled/planked) — only their COLOR changes`,
      `- DO NOT TOUCH door frames, window frames, or any other trim — leave them EXACTLY as they are in Image 1. Only baseboard COLOR changes.`,
      `- The transition between floor and baseboard must be clean and sharp`,
      ``,
      `PERSPECTIVE & GEOMETRY:`,
      `- The floor material must follow the room's vanishing point(s) precisely`,
      `- Planks/tiles closer to camera appear larger, those farther away appear smaller (proper foreshortening)`,
      `- Material lines must converge correctly toward the vanishing point`,
      `- Where the floor meets walls, furniture legs, or other objects, the transition must be clean and precise`,
      ``,
      `LIGHTING & REALISM:`,
      `- Cast existing shadows from furniture onto the new floor naturally`,
      `- If the original floor had reflections (from windows, lights), apply similar reflections on the new material appropriate to its finish (matte materials reflect less, glossy materials reflect more)`,
      `- Match the overall brightness and exposure of the floor area to the rest of the room`,
      `- If there are light pools (from windows or lamps), they should appear naturally on the new floor surface`,
      ``,
      `OUTPUT: A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks, no borders. Just the room with the new floor.`,
    ].filter(Boolean).join("\n");
  }

  return [
    `You are a world-class architectural visualization engine specializing in photorealistic interior material replacement.`,
    ``,
    `INPUT:`,
    `- IMAGE 1: A photograph of a real room (the "source room") — dimensions: ${width}x${height} pixels`,
    `- IMAGE 2: A product material sample/swatch called "${productName}" (the "target material")`,
    opts?.productDescription ? `- Product description: "${opts.productDescription}"` : ``,
    ``,
    `TASK: Generate a single photorealistic image that is PIXEL-IDENTICAL to Image 1 in every way, EXCEPT the wall surfaces are replaced with the material from Image 2.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `ABSOLUTE CONSTRAINTS (violating any of these = failure):`,
    `1. ONLY wall surfaces may change. EVERYTHING ELSE must be pixel-identical to Image 1.`,
    `2. DO NOT REMOVE, ALTER, or MODIFY: window frames, window sills, door frames, doors, baseboards, floor, ceiling, furniture, rugs, decor, curtains, radiators, electrical outlets, light switches, shelves, artwork, mirrors, people, pets, plants.`,
    `3. Window frames and window sills MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape. Do NOT recolor or replace them.`,
    `4. Door frames MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape.`,
    `5. BASEBOARDS (gólflístar) MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape. Do NOT recolor them. Baseboards only change color when the FLOOR is changed, NOT when walls are changed.`,
    `5. The camera angle, lens distortion, field of view, and perspective must be IDENTICAL to Image 1`,
    `6. Room geometry, proportions, and spatial layout must not change AT ALL`,
    `7. Lighting direction, intensity, color temperature, and ambient light must match Image 1 exactly`,
    `8. The output image MUST have the EXACT same dimensions (${width}x${height}px) and aspect ratio as Image 1`,
    ``,
    `COLOR ACCURACY (CRITICAL — THIS IS THE MOST IMPORTANT RULE):`,
    `- The wall material color MUST EXACTLY match the color shown in Image 2. Do NOT shift, reinterpret, or change the hue/saturation/brightness.`,
    `- If Image 2 is white → the walls MUST be the exact same white. If grey → exact same grey. If blue → exact same blue.`,
    `- Every single tile/panel must be the SAME color as Image 2. Do NOT invent new colors or tones.`,
    `- Analyze the dominant RGB color values in Image 2 and reproduce them faithfully on the walls.`,
    `- The ONLY acceptable color variation is from lighting effects (shadows, reflections) — the base material color stays identical to Image 2.`,
    ``,
    `WALL MATERIAL APPLICATION RULES:`,
    `- Study Image 2 carefully: identify the material type (ceramic tiles, stone, paint texture, wood panels, wallpaper, etc.)`,
    `- If it's TILE/CERAMIC: render with proper grout lines (thin, consistent width), correct tile dimensions. ALL tiles must be the SAME uniform color as shown in Image 2 — do NOT add random color variation between tiles.`,
    `- If it's STONE/MARBLE: render with natural veining matching Image 2's pattern, realistic surface depth, and proper joint lines. Keep the SAME color as Image 2.`,
    `- If it's WOOD PANELS: render with visible grain matching Image 2, and proper panel joints. All panels must be the SAME color/tone as Image 2.`,
    `- If it's a SOLID/PAINT texture: apply uniformly with the material's natural texture and finish, matching Image 2's exact color.`,
    `- The material MUST tile seamlessly — no visible repetition patterns, no obvious mirroring artifacts`,
    dimensionInfo
      ? `- EXACT DIMENSIONS: ${dimensionInfo}`
      : `- Scale the material realistically: standard wall tiles are roughly 10x30cm to 30x60cm`,
    ``,
    `LAYING PATTERN (CRITICAL):`,
    `- The tiles MUST be laid in the following pattern: ${patternInstruction}`,
    `- Follow this pattern precisely across all wall surfaces`,
    `- The pattern must be geometrically correct and consistent`,
    ``,
    `WALL IDENTIFICATION & BOUNDARIES:`,
    `- Replace ALL visible wall surfaces in the room`,
    `- STOP at boundaries: where walls meet the ceiling (ceiling stays unchanged), where walls meet the floor (floor stays unchanged), at door frames, window frames, and built-in fixtures`,
    `- Do NOT cover or remove: electrical outlets, light switches, vents, wall-mounted fixtures, shelves, artwork, mirrors — these remain on top of the new wall material`,
    `- BASEBOARDS / SKIRTING BOARDS (gólflístar — the small horizontal trim at the bottom of walls): These MUST REMAIN COMPLETELY UNCHANGED. Same color, same shape, same material as Image 1. Do NOT recolor them. Do NOT remove them. Baseboards are associated with the FLOOR, not the walls — they ONLY change color when the floor material changes.`,
    `- DO NOT TOUCH door frames, window frames, baseboards, or any other trim — leave them ALL EXACTLY as they are in Image 1.`,
    `- Corners where two walls meet must show a clean material edge/joint`,
    ``,
    `PERSPECTIVE & GEOMETRY:`,
    `- Each wall is a flat plane — the material must follow the wall's flat geometry precisely`,
    `- Side walls in perspective: material lines must converge toward the vanishing point`,
    `- Front-facing walls: material should appear face-on with minimal distortion`,
    `- Material scale must be consistent across all walls (a tile that is 30cm on the front wall must appear proportionally correct on side walls)`,
    ``,
    `LIGHTING & REALISM:`,
    `- Preserve existing shadow patterns on walls (from furniture, window frames, etc.)`,
    `- If original walls had light gradients (darker in corners, brighter near windows), apply similar gradients to the new material`,
    `- Match surface finish: glossy tiles should have subtle specular highlights, matte materials should absorb light`,
    `- Wall areas behind/under furniture should be slightly darker (ambient occlusion)`,
    ``,
    `OUTPUT: A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks, no borders. Just the room with the new walls.`,
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
    `You are a world-class architectural visualization engine specializing in photorealistic interior material replacement.`,
    ``,
    `INPUT:`,
    `- IMAGE 1: A photograph of a real room (the "source room") — dimensions: ${width}x${height} pixels`,
    `- IMAGE 2: A floor material sample/swatch called "${floorProductName}" (the "floor material")`,
    opts?.floorProductDescription ? `  Floor product description: "${opts.floorProductDescription}"` : ``,
    `- IMAGE 3: A wall material sample/swatch called "${wallProductName}" (the "wall material")`,
    opts?.wallProductDescription ? `  Wall product description: "${opts.wallProductDescription}"` : ``,
    ``,
    `TASK: Generate a single photorealistic image that is PIXEL-IDENTICAL to Image 1 in every way, EXCEPT:`,
    `  1. The FLOOR surface is replaced with the material from Image 2`,
    `  2. ALL WALL surfaces are replaced with the material from Image 3`,
    `Both replacements happen in the SAME output image.`,
    ``,
    `${sizeInstruction}`,
    ``,
    `ABSOLUTE CONSTRAINTS (violating any of these = failure):`,
    `1. ONLY floor surfaces, wall surfaces, and baseboard COLOR may change. EVERYTHING ELSE must be pixel-identical to Image 1.`,
    `2. DO NOT REMOVE, ALTER, or MODIFY: window frames, window sills, door frames, doors, baseboards (keep shape — only recolor), ceiling, furniture, rugs, decor, curtains, radiators, electrical outlets, light switches, shelves, artwork, mirrors, people, pets, plants.`,
    `3. Window frames and window sills MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape. Do NOT recolor or replace them.`,
    `4. Door frames MUST remain EXACTLY as they appear in Image 1 — same color, same material, same shape.`,
    `5. The camera angle, lens distortion, field of view, and perspective must be IDENTICAL to Image 1`,
    `6. Room geometry, proportions, and spatial layout must not change AT ALL`,
    `7. Lighting direction, intensity, color temperature, and ambient light must match Image 1 exactly`,
    `8. The output image MUST have the EXACT same dimensions (${width}x${height}px) and aspect ratio as Image 1`,
    ``,
    `--- COLOR ACCURACY (CRITICAL — MOST IMPORTANT RULE) ---`,
    `- The floor material color MUST EXACTLY match Image 2. The wall material color MUST EXACTLY match Image 3.`,
    `- Do NOT shift, reinterpret, or change the hue/saturation/brightness of either material.`,
    `- Every tile/plank on the floor must be the SAME color as Image 2. Every tile/panel on walls must be the SAME color as Image 3.`,
    `- Do NOT invent new colors or add random color variation between tiles — keep ALL tiles/planks the SAME uniform color as the source image.`,
    `- The ONLY acceptable variation is from lighting effects (shadows, reflections) — base material color stays identical to the product image.`,
    ``,
    `--- FLOOR MATERIAL (Image 2: "${floorProductName}") ---`,
    `- Study Image 2: identify material type (wood planks, ceramic tiles, stone, vinyl, etc.)`,
    `- Wood/parquet: render individual planks with grain matching Image 2, realistic joints. ALL planks same color as Image 2.`,
    `- Tile/ceramic: render with proper grout lines, correct dimensions. ALL tiles same uniform color as Image 2 — NO random color variation.`,
    `- Stone/marble: render with veining matching Image 2, realistic texture, joint lines. Same color as Image 2.`,
    `- Material must tile seamlessly — no visible repetition or mirroring artifacts`,
    floorDim ? `- ${floorDim}` : `- Scale realistically: tiles ~30-60cm, planks ~10-20cm wide × 60-200cm long`,
    `- LAYING PATTERN: ${floorPattern}`,
    `- Floor stops where it meets the wall — clean boundary`,
    ``,
    `--- WALL MATERIAL (Image 3: "${wallProductName}") ---`,
    `- Study Image 3: identify material type (ceramic tiles, stone, wood panels, wallpaper, etc.)`,
    `- Tile/ceramic: render with proper grout lines, correct dimensions. ALL tiles same uniform color as Image 3 — NO random color variation.`,
    `- Stone/marble: render with veining matching Image 3, realistic depth, joint lines. Same color as Image 3.`,
    `- Wood panels: render with grain matching Image 3, proper joints. ALL panels same color as Image 3.`,
    `- Solid/paint texture: apply uniformly matching Image 3's exact color and finish.`,
    `- Material must tile seamlessly — no visible repetition or mirroring artifacts`,
    wallDim ? `- ${wallDim}` : `- Scale realistically: wall tiles ~10-30cm × 30-60cm`,
    `- LAYING PATTERN: ${wallPattern}`,
    `- Replace ALL visible wall surfaces. Stop at ceiling, floor, door frames, window frames`,
    `- Do NOT cover outlets, switches, vents, shelves, artwork, mirrors`,
    ``,
    `--- BASEBOARDS (CRITICAL — DO NOT REMOVE) ---`,
    `- BASEBOARDS / SKIRTING BOARDS (gólflístar — the small horizontal trim strips at the bottom of walls): These MUST REMAIN in the image. DO NOT REMOVE THEM. DO NOT ERASE THEM. Keep their exact shape, size, and position.`,
    `- ONLY change the COLOR of the baseboards to match the dominant tone of the new floor material (Image 2).`,
    `- Baseboards must remain as solid painted wood strips — only their COLOR changes`,
    `- DO NOT touch door frames, window frames, or any other trim — leave them EXACTLY as in Image 1`,
    ``,
    `--- PERSPECTIVE & GEOMETRY ---`,
    `- Floor material follows room vanishing point(s) — tiles farther away appear smaller`,
    `- Wall material follows each wall's flat geometry — side walls converge to vanishing point`,
    `- Material scale must be consistent: same tile size on all surfaces, perspective-adjusted`,
    ``,
    `--- LIGHTING & REALISM ---`,
    `- Cast existing shadows from furniture onto the new floor naturally`,
    `- Preserve wall shadow patterns (from furniture, window frames, etc.)`,
    `- Apply reflections appropriate to material finish (matte less, glossy more)`,
    `- Match overall brightness and exposure to the rest of the room`,
    `- Light pools from windows/lamps should appear naturally on both surfaces`,
    ``,
    `OUTPUT: A single photorealistic image at exactly ${width}x${height} pixels. No text, no labels, no watermarks, no borders. Just the room with the new floor AND new walls.`,
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
