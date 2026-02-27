/**
 * Gemini-based room measurement estimation — Surface-type aware analysis.
 *
 * Uses Gemini's vision capabilities to estimate room dimensions from a photo.
 *
 * Strategy:
 *   Pass 1 — Deep analysis: Identifies reference objects, counts tiles,
 *            analyzes perspective, reasons through geometry step by step.
 *            Prompt is FOCUSED on the requested surface (floor OR wall).
 *   Pass 2 — Quick cross-check: Validates Pass 1 with a different angle.
 *            Final result is a weighted average of both passes.
 *
 * When tile dimensions are known (from product data), Gemini can count
 * tiles in the generated result image for highly accurate measurements.
 *
 * Surface-type awareness:
 *   - "floor" → Focus on floor area (width × length)
 *   - "wall"  → Focus on wall surface area (wall widths × height − openings)
 *   - "both"  → Estimate both carefully
 *
 * Room-type-aware defaults prevent nonsensical estimates.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export interface GeminiRoomMeasurements {
  floorArea: number;       // m²
  wallArea: number;        // m² (visible wall area minus doors/windows)
  roomWidth: number;       // meters
  roomLength: number;      // meters
  roomHeight: number;      // meters
  confidence: number;      // 0-1 how confident the estimate is
  roomType: string | null; // e.g. "bathroom", "kitchen", "living_room"
  notes: string;           // explanation of the estimation
}

export interface MeasureOptions {
  /** Known tile/plank dimensions from the product database */
  knownTileDimensions?: { widthCm: number; heightCm: number };
  /** The AI-generated result image with product applied (tiles are clearly visible) */
  resultImage?: { base64: string; mimeType: string };
  /** Which surface was changed: floor, wall, or both */
  surfaceType?: "floor" | "wall" | "both";
}

interface RawMeasurement {
  roomWidth: number;
  roomLength: number;
  roomHeight: number;
  floorArea: number;
  wallArea: number;
  confidence: number;
  roomType: string | null;
  notes: string;
  referenceObjects?: string[];
  tileCount?: { horizontal?: number; vertical?: number; tileSize?: string };
  wallCount?: number;
  wallWidths?: number[];
}

// ---- Typical room sizes in Icelandic homes (m²) ----
const ROOM_TYPE_RANGES: Record<string, { floorMin: number; floorMax: number; floorTypical: number; wallMin: number; wallMax: number; wallTypical: number }> = {
  bathroom:    { floorMin: 2,  floorMax: 10,  floorTypical: 5,   wallMin: 6,  wallMax: 30,  wallTypical: 15 },
  kitchen:     { floorMin: 5,  floorMax: 20,  floorTypical: 10,  wallMin: 10, wallMax: 50,  wallTypical: 25 },
  living_room: { floorMin: 12, floorMax: 40,  floorTypical: 22,  wallMin: 25, wallMax: 80,  wallTypical: 45 },
  bedroom:     { floorMin: 8,  floorMax: 20,  floorTypical: 12,  wallMin: 18, wallMax: 50,  wallTypical: 30 },
  hallway:     { floorMin: 2,  floorMax: 12,  floorTypical: 5,   wallMin: 8,  wallMax: 30,  wallTypical: 15 },
  laundry:     { floorMin: 2,  floorMax: 8,   floorTypical: 4,   wallMin: 5,  wallMax: 20,  wallTypical: 12 },
  office:      { floorMin: 6,  floorMax: 18,  floorTypical: 10,  wallMin: 15, wallMax: 45,  wallTypical: 25 },
  dining_room: { floorMin: 8,  floorMax: 25,  floorTypical: 14,  wallMin: 18, wallMax: 60,  wallTypical: 35 },
};

// ---- Build prompts dynamically based on surface type ----

function buildPass1Prompt(options?: MeasureOptions): string {
  const surfaceType = options?.surfaceType || "floor";

  const tileSizeHint = options?.knownTileDimensions
    ? `\n\nCRITICAL TILE INFORMATION — USE THIS FOR PRECISE MEASUREMENT:
The tiles/planks in this room are EXACTLY ${options.knownTileDimensions.widthCm} × ${options.knownTileDimensions.heightCm} cm each.
This is verified product data. Count the tiles carefully:
- Count how many tiles fit across the WIDTH of the surface (including partial tiles)
- Count how many tiles fit along the LENGTH/HEIGHT of the surface (including partial tiles)
- Surface dimension = tile count × tile size
- Include partial tiles as fractions (e.g. if you see 5.5 tiles, count 5.5)
THIS IS THE MOST ACCURATE METHOD — prioritize tile counting over other references when tiles are visible.`
    : "";

  const resultImageHint = options?.resultImage
    ? `\n\nNOTE: You are given TWO images. The FIRST image is the original room photo. The SECOND image is the same room with new ${surfaceType === "wall" ? "wall tiles" : surfaceType === "both" ? "floor and wall tiles" : "flooring"} applied digitally. Use BOTH images:
- The original photo helps identify doors, windows, furniture, and other reference objects
- The result image shows the new tiles/flooring clearly — use this for tile counting since the tile edges are crisp and visible`
    : "";

  // Surface-type-specific focus instructions
  const surfaceFocus = surfaceType === "wall"
    ? `
⚠️  YOUR PRIMARY TASK IS TO MEASURE THE WALL SURFACE AREA ⚠️
You are estimating how many m² of WALL TILES are needed.

Think carefully about walls:
- How many walls are visible in the photo? (usually 2-3 visible)
- How many walls TOTAL does this room have? (usually 4)
- What is the WIDTH of EACH wall you can see?
- What is the ceiling HEIGHT? (typically 2.4-2.5m in Iceland)
- Subtract door openings (~2.0m × 0.83m = 1.7 m² each)
- Subtract window openings (estimate each window size)
- Subtract large mirrors, built-in cabinets that cover the wall

WALL AREA FORMULA:
  wall_area = (wall1_width × height) + (wall2_width × height) + ... − door_openings − window_openings

TYPICAL WALL AREAS for tiling:
- Small bathroom (2-3 walls tiled): 8-15 m²
- Medium bathroom (3-4 walls tiled): 15-22 m²
- Large bathroom (all walls): 20-30 m²
- Kitchen backsplash (partial wall): 2-5 m²
- Kitchen (full walls): 10-25 m²
- Shower area only: 4-8 m²

IMPORTANT: Wall area is NOT the same as floor area!
A bathroom with a 5 m² floor can have 15-20 m² of wall area because walls are VERTICAL and there are 3-4 of them.
Think about it: a 2m × 2.5m bathroom has 4 walls = 2×(2+2.5)×2.5 = 22.5 m² of wall surface before subtracting openings.

Do NOT just guess 12 m². Actually count walls, estimate their widths, multiply by height, and subtract openings.`

    : surfaceType === "both"
    ? `
⚠️  YOUR TASK IS TO MEASURE BOTH FLOOR AND WALL SURFACE AREAS ⚠️
You need BOTH measurements — be careful to calculate each one separately.

FLOOR: width × length of the room
WALLS: sum of (each wall width × ceiling height) minus door/window openings

These are VERY different numbers for the same room!
Example: A 3m × 2m bathroom = 6 m² floor, but walls = 2×(3+2)×2.5 − openings ≈ 20-22 m²

Do NOT use the same number for both. Calculate each independently.`

    : `
⚠️  YOUR PRIMARY TASK IS TO MEASURE THE FLOOR AREA ⚠️
You are estimating how many m² of FLOORING/FLOOR TILES are needed.

Think carefully about the floor:
- The floor is the HORIZONTAL surface you walk on
- Floor area = room width × room length
- For L-shaped rooms, split into rectangles and add
- Look at furniture, fixtures on the floor for size clues

TYPICAL FLOOR AREAS:
- Small bathroom: 3-5 m²
- Medium bathroom: 5-8 m²
- Small kitchen: 6-10 m²
- Medium kitchen: 10-15 m²
- Living room: 15-30 m²
- Bedroom: 10-16 m²
- Hallway: 3-8 m²
- Laundry room: 2-5 m²

IMPORTANT: Actually analyze THIS specific room. A tiny half-bath floor is 2-3 m². A large master bathroom might be 10 m².
Do NOT default to 12 m² — that's a very specific size that only fits certain rooms.
Look at the photo and THINK about how big this actual room is.`;

  return `You are a senior architectural surveyor who estimates room dimensions from photographs. You have 20 years of experience measuring rooms from photos for renovation projects in Iceland.

TASK: Analyze this room photograph step by step and estimate the REAL dimensions.
${surfaceFocus}${tileSizeHint}${resultImageHint}

STEP 1 — IDENTIFY THE ROOM TYPE
What type of room is this? (bathroom, kitchen, living room, bedroom, hallway, laundry room, etc.)
This matters because room types have typical size ranges in Icelandic homes:
- Bathroom: floor 3-8 m², wall area 8-25 m²
- Kitchen: floor 8-15 m², wall area 10-35 m²
- Living room: floor 15-30 m², wall area 25-60 m²
- Bedroom: floor 10-16 m², wall area 20-40 m²
- Hallway: floor 3-8 m², wall area 8-20 m²

STEP 2 — FIND ALL REFERENCE OBJECTS
List EVERY object in the image with known real-world size:
- DOORS: Standard interior door = 2.04m tall × 0.83m wide (Icelandic/European standard)
- WINDOWS: Standard window sill height ~0.9m from floor
- ELECTRICAL OUTLETS: Center ~25-30cm from floor
- LIGHT SWITCHES: Center ~1.05m from floor
- TOILET: Height ~40cm, depth ~65-70cm, width ~35-38cm
- BATHTUB: Length 150-170cm, width 70cm, height 55-60cm
- SHOWER TRAY: 80×80cm, 90×90cm, or 80×120cm
- SINK / WASHBASIN: Width 45-60cm, mounted at ~85cm from floor
- KITCHEN COUNTER: Height = 90cm, depth = 60cm
- KITCHEN CABINETS: Upper 60-72cm tall, lower = counter height
- REFRIGERATOR: Height 170-190cm, width 60cm
- WASHING MACHINE: 85cm tall × 60cm wide
- SOFA: 3-seater ~200cm long, height ~85cm
- BED: Single 90×200cm, double 140-180×200cm

STEP 3 — COUNT TILES OR PLANKS (if visible)
${options?.knownTileDimensions
    ? `YOU KNOW the tile size is ${options.knownTileDimensions.widthCm}×${options.knownTileDimensions.heightCm} cm — use this exact size!
Count tiles carefully on the ${surfaceType === "wall" ? "WALLS" : surfaceType === "both" ? "FLOOR AND WALLS" : "FLOOR"}:
- For partial tiles at edges, estimate the fraction (e.g., half a tile = 0.5)
- ${surfaceType === "wall" ? "Count tiles across each wall width and up the wall height" : "Count tiles across the floor width and along the floor length"}
- Dimension = tile count × tile size`
    : `If tiles/planks are visible on the ${surfaceType === "wall" ? "walls" : surfaceType === "both" ? "floor and walls" : "floor"}:
- Count tiles in each direction
- Estimate tile size from reference objects
- Calculate: dimension = tile count × tile size`}

STEP 4 — ANALYZE PERSPECTIVE & CALCULATE DIMENSIONS
- Use vanishing points and converging lines to estimate depth vs width
- Cross-reference with at least 2 different reference objects
- ${surfaceType === "wall"
    ? "For EACH visible wall: estimate its width using reference objects, then multiply by ceiling height"
    : "Estimate room width and length using reference objects, then calculate floor area = width × length"}

STEP 5 — COMPUTE AREAS
${surfaceType === "wall" ? `
WALL AREA (your PRIMARY measurement):
- For EACH wall: width × ceiling height
- Subtract each door: ~1.7 m²
- Subtract each window: ~1.0-2.0 m²
- Sum all wall surfaces that would be tiled
Also estimate floor area for reference: width × length
` : surfaceType === "both" ? `
FLOOR AREA: width × length (for rectangular rooms, split L-shapes into rectangles)
WALL AREA: for each wall (width × height), then subtract doors (~1.7m² each) and windows (~1.0-2.0m² each)
Calculate BOTH carefully — they should be different numbers.
` : `
FLOOR AREA (your PRIMARY measurement): width × length
For L-shaped rooms, split into rectangles and add.
Also estimate wall area for reference: perimeter × height − openings
`}

STEP 6 — SANITY CHECK
Before giving your final answer, ask yourself:
- Does the ${surfaceType === "wall" ? "wall area" : "floor area"} make sense for this room type?
- ${surfaceType === "wall"
    ? "A bathroom wall area of 5 m² is suspiciously low — that's barely one small wall. Most tiled bathrooms need 10-25 m²."
    : "A living room floor of 5 m² is impossibly small. A bathroom floor of 25 m² is way too big."}
- Did I actually use reference objects, or did I just guess?
- ${surfaceType === "floor"
    ? "Floor area should be width × length. Verify: if width=3m and length=4m, floor=12m². If width=2m and length=2.5m, floor=5m²."
    : "Wall area should be significantly LARGER than floor area (walls are tall and there are multiple)."}

NOW RESPOND with ONLY a valid JSON object (no markdown, no code blocks):

{
  "roomType": "bathroom" | "kitchen" | "living_room" | "bedroom" | "hallway" | "laundry" | "office" | "dining_room" | null,
  "roomWidth": <meters, 1 decimal>,
  "roomLength": <meters, 1 decimal>,
  "roomHeight": <meters, 1 decimal — ceiling height>,
  "floorArea": <m², 1 decimal — width × length>,
  "wallArea": <m², 1 decimal — total tileable wall surface minus openings>,
  "wallCount": <number of walls that would be tiled, e.g. 3 or 4>,
  "wallWidths": [<width of each wall in meters>],
  "confidence": <0.0-1.0>,
  "referenceObjects": [<list of objects used, e.g. "door (2.04m)", "toilet (0.4m high)">],
  "tileCount": {"horizontal": <tiles across or null>, "vertical": <tiles along or null>, "tileSize": "<WxH cm or null>"},
  "notes": "<1-2 sentences: which references gave you the dimensions>"
}`;
}

function buildPass2Prompt(options?: MeasureOptions): string {
  const surfaceType = options?.surfaceType || "floor";

  const tileSizeHint = options?.knownTileDimensions
    ? `\nIMPORTANT: Tiles are ${options.knownTileDimensions.widthCm}×${options.knownTileDimensions.heightCm} cm each. Count them for accuracy.`
    : "";

  const surfaceInstruction = surfaceType === "wall"
    ? `Your MAIN job is estimating the WALL SURFACE AREA (m² of wall tiles needed).
Think: how many walls × width × ceiling height − doors − windows.
A typical tiled bathroom has 10-25 m² of wall area.
Do NOT confuse wall area with floor area — walls are vertical and there are multiple.`
    : surfaceType === "both"
    ? `Estimate BOTH floor area AND wall area separately.
Floor = width × length. Walls = sum of each wall's width × height minus openings.
These should be DIFFERENT numbers.`
    : `Your MAIN job is estimating the FLOOR AREA (m² of flooring needed).
Think: room width × room length.
A tiny bathroom floor is 3-4 m². A large living room is 20-30 m².
Do NOT default to 12 m² — analyze the actual room.`;

  return `You are a construction estimator. Look at this room photo and estimate room dimensions.

${surfaceInstruction}

Quick method:
1. Is there a door? Door height = 2.04m → ceiling height
2. Room width: how many door-widths wide? (1 door width = 0.83m)
3. Room length/depth: estimate from furniture and perspective
4. Room type? Use typical sizes:
   - Bathroom: floor 3-8m², walls 8-25m²
   - Kitchen: floor 8-15m², walls 10-35m²
   - Living room: floor 15-30m², walls 25-60m²
   - Bedroom: floor 10-16m², walls 20-40m²
5. Count tiles if visible — best measurement method${tileSizeHint}

SANITY CHECK: ${surfaceType === "wall"
    ? "Wall area should be LARGER than floor area. A 5m² bathroom floor has ~15m² of wall area."
    : "Does your floor area match the room type? A bathroom is NOT 12m² — that would be a bedroom."}

Respond with ONLY valid JSON (no markdown):
{
  "roomWidth": <meters>,
  "roomLength": <meters>,
  "roomHeight": <meters>,
  "floorArea": <m²>,
  "wallArea": <m²>,
  "wallCount": <number of tiled walls>,
  "confidence": <0-1>,
  "roomType": <string or null>,
  "notes": "<brief reasoning>"
}`;
}

/**
 * Estimate room dimensions from a photo using dual-pass Gemini analysis.
 * When knownTileDimensions are provided, Gemini counts tiles for precision.
 * When a resultImage is provided, it's used alongside the room photo for better analysis.
 */
export async function measureRoomWithGemini(
  imageBase64: string,
  mimeType: string,
  options?: MeasureOptions
): Promise<GeminiRoomMeasurements> {
  const roomImageData = { inlineData: { mimeType, data: imageBase64 } };

  // Build image array — include result image if available
  const images: Array<{ inlineData: { mimeType: string; data: string } }> = [roomImageData];
  if (options?.resultImage) {
    images.push({
      inlineData: {
        mimeType: options.resultImage.mimeType,
        data: options.resultImage.base64,
      },
    });
  }

  const pass1Prompt = buildPass1Prompt(options);
  const pass2Prompt = buildPass2Prompt(options);

  // Run both passes in parallel for speed
  const [pass1, pass2] = await Promise.allSettled([
    runPass(pass1Prompt, images, "pass1"),
    runPass(pass2Prompt, images, "pass2"),
  ]);

  const r1 = pass1.status === "fulfilled" ? pass1.value : null;
  const r2 = pass2.status === "fulfilled" ? pass2.value : null;

  if (pass1.status === "rejected") console.error("[GeminiMeasure] Pass 1 failed:", pass1.reason);
  if (pass2.status === "rejected") console.error("[GeminiMeasure] Pass 2 failed:", pass2.reason);

  if (!r1 && !r2) {
    console.error("[GeminiMeasure] Both passes failed — using smart defaults");
    return smartFallbackDefaults(options?.surfaceType);
  }

  // If only one pass succeeded, use it (with sanity checking)
  if (!r1) return sanitizeResult(toResult(r2!), options);
  if (!r2) return sanitizeResult(toResult(r1), options);

  // Both succeeded — smart merge
  return sanitizeResult(mergeResults(r1, r2, options), options);
}

async function runPass(
  prompt: string,
  images: Array<{ inlineData: { mimeType: string; data: string } }>,
  label: string
): Promise<RawMeasurement> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent([prompt, ...images]);
  const responseText = result.response.text().trim();

  // Parse JSON — strip markdown code blocks if present
  let jsonStr = responseText;
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  const data = JSON.parse(jsonStr);
  console.log(`[GeminiMeasure] ${label}:`, JSON.stringify(data, null, 2).substring(0, 600));

  return {
    roomWidth: clamp(data.roomWidth, 0.5, 30),
    roomLength: clamp(data.roomLength, 0.5, 30),
    roomHeight: clamp(data.roomHeight, 1.8, 5),
    floorArea: clamp(data.floorArea, 0.5, 200),
    wallArea: clamp(data.wallArea, 1, 500),
    confidence: clamp(data.confidence, 0, 1),
    roomType: data.roomType || null,
    notes: data.notes || "",
    referenceObjects: data.referenceObjects || [],
    tileCount: data.tileCount || undefined,
    wallCount: data.wallCount || undefined,
    wallWidths: data.wallWidths || undefined,
  };
}

/**
 * Merge two passes: weighted average based on confidence.
 * Pass 1 (deep analysis) gets a built-in bonus because it uses chain-of-thought.
 * When tile dimensions are known and tile counting was used, give extra weight.
 */
function mergeResults(r1: RawMeasurement, r2: RawMeasurement, options?: MeasureOptions): GeminiRoomMeasurements {
  // Pass 1 gets a confidence bonus (deeper analysis)
  let w1 = (r1.confidence + 0.15) * 1.2;
  let w2 = r2.confidence;

  // If pass 1 used tile counting with known dimensions, trust it even more
  if (options?.knownTileDimensions && r1.tileCount?.horizontal && r1.tileCount?.vertical) {
    w1 *= 1.5;
    console.log("[GeminiMeasure] Pass 1 used tile counting with known dimensions — boosting weight");
  }

  const total = w1 + w2;
  const avg = (a: number, b: number) => round((a * w1 + b * w2) / total);

  // Check agreement (within 30%)
  const widthAgree = Math.abs(r1.roomWidth - r2.roomWidth) / Math.max(r1.roomWidth, r2.roomWidth) < 0.3;
  const lengthAgree = Math.abs(r1.roomLength - r2.roomLength) / Math.max(r1.roomLength, r2.roomLength) < 0.3;
  const heightAgree = Math.abs(r1.roomHeight - r2.roomHeight) / Math.max(r1.roomHeight, r2.roomHeight) < 0.15;

  let confidence = avg(r1.confidence, r2.confidence);
  if (widthAgree && lengthAgree && heightAgree) {
    confidence = Math.min(1, confidence + 0.15);
  } else {
    confidence = Math.max(0.15, confidence - 0.1);
  }

  if (options?.knownTileDimensions && r1.tileCount?.horizontal) {
    confidence = Math.min(1, confidence + 0.1);
  }

  const roomWidth = avg(r1.roomWidth, r2.roomWidth);
  const roomLength = avg(r1.roomLength, r2.roomLength);
  const roomHeight = avg(r1.roomHeight, r2.roomHeight);
  const floorArea = round(roomWidth * roomLength); // recompute for consistency
  const wallArea = avg(r1.wallArea, r2.wallArea);

  // Build notes from pass 1
  let notes = r1.notes;
  if (r1.referenceObjects && r1.referenceObjects.length > 0) {
    notes = `Viðmið: ${r1.referenceObjects.slice(0, 4).join(", ")}. ${notes}`;
  }
  if (r1.tileCount?.horizontal && r1.tileCount?.tileSize) {
    notes += ` Flísatalning: ${r1.tileCount.horizontal}×${r1.tileCount.vertical || "?"} (${r1.tileCount.tileSize}).`;
  }
  if (!widthAgree || !lengthAgree) {
    notes += " Áætlun óviss — breyttu gildum ef þú veist betur.";
  }

  console.log(`[GeminiMeasure] Merged: ${roomWidth}×${roomLength}m, h=${roomHeight}m, floor=${floorArea}m², wall=${wallArea}m², conf=${confidence}`);
  console.log(`[GeminiMeasure] Agreement: w=${widthAgree}, l=${lengthAgree}, h=${heightAgree}`);

  return {
    floorArea,
    wallArea,
    roomWidth,
    roomLength,
    roomHeight,
    confidence: round(confidence),
    roomType: r1.roomType || r2.roomType,
    notes,
  };
}

/**
 * Sanity-check Gemini results against room type typical ranges.
 * If values are wildly off, adjust them toward reasonable ranges.
 */
function sanitizeResult(result: GeminiRoomMeasurements, options?: MeasureOptions): GeminiRoomMeasurements {
  const surfaceType = options?.surfaceType || "floor";
  const ranges = result.roomType ? ROOM_TYPE_RANGES[result.roomType] : null;

  if (!ranges) return result; // No room type detected, trust Gemini

  // Check floor area sanity
  if (result.floorArea < ranges.floorMin * 0.5) {
    console.log(`[GeminiMeasure] Floor area ${result.floorArea}m² suspiciously low for ${result.roomType} (min: ${ranges.floorMin}). Adjusting.`);
    // The Gemini estimate is way too low — bump up
    result.floorArea = Math.max(result.floorArea, ranges.floorMin);
    result.confidence = Math.max(0.15, result.confidence - 0.2);
    result.notes += ` Gólfflötur leiðréttur — of lítill fyrir ${result.roomType}.`;
  }
  if (result.floorArea > ranges.floorMax * 1.5) {
    console.log(`[GeminiMeasure] Floor area ${result.floorArea}m² suspiciously high for ${result.roomType} (max: ${ranges.floorMax}). Adjusting.`);
    result.floorArea = Math.min(result.floorArea, ranges.floorMax);
    result.confidence = Math.max(0.15, result.confidence - 0.2);
    result.notes += ` Gólfflötur leiðréttur — of stór fyrir ${result.roomType}.`;
  }

  // Check wall area sanity
  if (result.wallArea < ranges.wallMin * 0.5) {
    console.log(`[GeminiMeasure] Wall area ${result.wallArea}m² suspiciously low for ${result.roomType} (min: ${ranges.wallMin}). Adjusting.`);
    result.wallArea = Math.max(result.wallArea, ranges.wallMin);
    result.confidence = Math.max(0.15, result.confidence - 0.2);
    result.notes += ` Veggflötur leiðréttur — of lítill fyrir ${result.roomType}.`;
  }
  if (result.wallArea > ranges.wallMax * 1.5) {
    console.log(`[GeminiMeasure] Wall area ${result.wallArea}m² suspiciously high for ${result.roomType} (max: ${ranges.wallMax}). Adjusting.`);
    result.wallArea = Math.min(result.wallArea, ranges.wallMax);
    result.confidence = Math.max(0.15, result.confidence - 0.2);
    result.notes += ` Veggflötur leiðréttur — of stór fyrir ${result.roomType}.`;
  }

  // Wall area should typically be larger than floor area (multiple walls × height)
  if (surfaceType === "wall" && result.wallArea < result.floorArea * 0.8) {
    console.log(`[GeminiMeasure] Wall area (${result.wallArea}) < floor area (${result.floorArea}) — likely wrong. Recalculating.`);
    // Estimate wall area from dimensions: perimeter × height - ~15% for openings
    const perimeter = 2 * (result.roomWidth + result.roomLength);
    const estimatedWall = round(perimeter * result.roomHeight * 0.85);
    result.wallArea = Math.max(result.wallArea, estimatedWall);
    result.notes += ` Veggflötur endurreiknaður frá málum.`;
  }

  return result;
}

function toResult(r: RawMeasurement): GeminiRoomMeasurements {
  const roomWidth = round(r.roomWidth);
  const roomLength = round(r.roomLength);
  return {
    floorArea: round(roomWidth * roomLength),
    wallArea: round(r.wallArea),
    roomWidth,
    roomLength,
    roomHeight: round(r.roomHeight),
    confidence: round(r.confidence),
    roomType: r.roomType,
    notes: r.notes,
  };
}

/**
 * Smart fallback defaults based on surface type.
 * Instead of always returning 12m², return reasonable values
 * for the most common room type (bathroom) with low confidence
 * so the user knows to adjust.
 */
function smartFallbackDefaults(surfaceType?: string): GeminiRoomMeasurements {
  // Most common scenario: bathroom renovation
  // But mark confidence as very low so user knows to edit
  const isWall = surfaceType === "wall";
  const isBoth = surfaceType === "both";

  return {
    floorArea: 5, // Small-medium bathroom floor
    wallArea: 15, // Typical bathroom wall tiling area
    roomWidth: 2.2,
    roomLength: 2.3,
    roomHeight: 2.5,
    confidence: 0.1,
    roomType: "bathroom",
    notes: isWall
      ? "Sjálfvirk mæling mistókst — áætlaður veggflötur (15 m²) er leiðréttanlegt. Breyttu gildum."
      : isBoth
      ? "Sjálfvirk mæling mistókst — áætluð gildi. Breyttu gildum handvirkt."
      : "Sjálfvirk mæling mistókst — áætlaður gólfflötur (5 m²) er leiðréttanlegt. Breyttu gildum.",
  };
}

function clamp(n: number, min: number, max: number): number {
  if (typeof n !== "number" || isNaN(n)) return (min + max) / 2;
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
