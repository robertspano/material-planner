import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { measureRoom, fetchImageBuffer } from "@/lib/wizart";
import { measureRoomWithGemini } from "@/lib/gemini-measure";

/**
 * POST /api/planner/measure?company=slug
 *
 * Measures room dimensions from the uploaded photo.
 * Strategy:
 *   1. Check cache (Generation record) — but only if confidence > 0.1
 *      (low confidence = fallback defaults that should be re-measured)
 *   2. Use Wizart Vision API if WIZART_API_KEY is configured (most accurate)
 *   3. Fall back to Gemini vision estimation (free, surface-type aware)
 *
 * Returns floor area, wall area, and room dimensions.
 * Caches results in the Generation record.
 */
export async function POST(request: NextRequest) {
  try {
    const { roomImageUrl, generationId, resultImageUrl, tileWidth, tileHeight, surfaceType } = await request.json();

    if (!roomImageUrl) {
      return NextResponse.json({ error: "roomImageUrl required" }, { status: 400 });
    }

    // Known tile dimensions (in cm) — used by Gemini for precise tile counting
    const knownTileDimensions = (tileWidth && tileHeight)
      ? { widthCm: tileWidth, heightCm: tileHeight }
      : undefined;

    // Check if we already have cached measurements for this generation
    // BUT: skip cache if we now have result image or tile dimensions that weren't
    // available before (can improve accuracy), or if cached values look like fallback defaults
    if (generationId) {
      const existing = await prisma.generation.findUnique({
        where: { id: generationId },
        select: { floorArea: true, wallArea: true, roomWidth: true, roomLength: true, roomHeight: true },
      });

      if (existing?.floorArea != null && existing?.wallArea != null) {
        // Detect stale fallback values: floorArea=12 + wallArea=28 was the old default,
        // floorArea=5 + wallArea=15 is the new default. Re-measure if we have better data now.
        const isOldFallback = existing.floorArea === 12 && existing.wallArea === 28;
        const isNewFallback = existing.floorArea === 5 && existing.wallArea === 15;
        const isFallback = isOldFallback || isNewFallback;

        // If we have a result image or tile dimensions, re-measure even cached
        // results to get better accuracy (but only if it was a fallback)
        const hasNewData = !!resultImageUrl || !!knownTileDimensions;

        if (!isFallback || !hasNewData) {
          console.log("[Measure] Using cached measurements for generation:", generationId,
            { floorArea: existing.floorArea, wallArea: existing.wallArea });
          return NextResponse.json({
            floorArea: existing.floorArea,
            wallArea: existing.wallArea,
            roomWidth: existing.roomWidth,
            roomLength: existing.roomLength,
            roomHeight: existing.roomHeight,
            cached: true,
            source: "cache",
          });
        }

        console.log("[Measure] Cached values look like fallback defaults — re-measuring with better data");
      }
    }

    // ---- Strategy 1: Wizart Vision API (if configured) ----
    if (process.env.WIZART_API_KEY) {
      try {
        const imageBuffer = await fetchImageBuffer(roomImageUrl);
        const measurements = await measureRoom(imageBuffer);

        console.log("[Measure] Wizart results:", {
          floorArea: measurements.floorArea,
          wallArea: measurements.wallArea,
          roomHeight: measurements.roomHeight,
          roomType: measurements.roomType,
          walls: measurements.walls.length,
        });

        const estimatedSide = Math.sqrt(measurements.floorArea);
        const roomWidth = measurements.walls.length >= 2
          ? measurements.walls[0].width
          : estimatedSide;
        const roomLength = measurements.walls.length >= 2
          ? measurements.walls[1].width
          : estimatedSide;

        // Cache results
        if (generationId) {
          await prisma.generation.update({
            where: { id: generationId },
            data: {
              floorArea: measurements.floorArea,
              wallArea: measurements.wallArea,
              roomWidth: Math.round(roomWidth * 100) / 100,
              roomLength: Math.round(roomLength * 100) / 100,
              roomHeight: measurements.roomHeight,
            },
          });
        }

        return NextResponse.json({
          floorArea: measurements.floorArea,
          wallArea: measurements.wallArea,
          totalWallArea: measurements.totalWallArea,
          roomWidth: Math.round(roomWidth * 100) / 100,
          roomLength: Math.round(roomLength * 100) / 100,
          roomHeight: measurements.roomHeight,
          walls: measurements.walls,
          windows: measurements.windows,
          doors: measurements.doors,
          roomType: measurements.roomType,
          confidence: measurements.confidence,
          cached: false,
          source: "wizart",
        });
      } catch (wizartError) {
        console.error("[Measure] Wizart failed, falling back to Gemini:", wizartError);
        // Fall through to Gemini
      }
    }

    // ---- Strategy 2: Gemini Vision estimation (free, surface-type aware) ----
    if (process.env.GEMINI_API_KEY) {
      console.log("[Measure] Using Gemini vision estimation", {
        hasTileDimensions: !!knownTileDimensions,
        hasResultImage: !!resultImageUrl,
        surfaceType,
      });

      // Fetch room image and convert to base64
      const imageBuffer = await fetchImageBuffer(roomImageUrl);
      const base64 = imageBuffer.toString("base64");
      const mimeType = roomImageUrl.endsWith(".png") ? "image/png"
        : roomImageUrl.endsWith(".webp") ? "image/webp"
        : "image/jpeg";

      // Optionally fetch the result image (with product applied) for tile counting
      let resultBase64: string | undefined;
      let resultMimeType: string | undefined;
      if (resultImageUrl) {
        try {
          const resultBuf = await fetchImageBuffer(resultImageUrl);
          resultBase64 = resultBuf.toString("base64");
          resultMimeType = resultImageUrl.endsWith(".png") ? "image/png"
            : resultImageUrl.endsWith(".webp") ? "image/webp"
            : "image/jpeg";
        } catch (e) {
          console.warn("[Measure] Could not fetch result image for measurement:", e);
        }
      }

      const measurements = await measureRoomWithGemini(base64, mimeType, {
        knownTileDimensions,
        resultImage: resultBase64 ? { base64: resultBase64, mimeType: resultMimeType! } : undefined,
        surfaceType: surfaceType || "floor",
      });

      console.log("[Measure] Gemini results:", {
        floorArea: measurements.floorArea,
        wallArea: measurements.wallArea,
        roomWidth: measurements.roomWidth,
        roomLength: measurements.roomLength,
        roomHeight: measurements.roomHeight,
        confidence: measurements.confidence,
        roomType: measurements.roomType,
        notes: measurements.notes,
        surfaceType,
      });

      // Cache results (only if confidence is reasonable — don't cache total failures)
      if (generationId && measurements.confidence > 0.1) {
        await prisma.generation.update({
          where: { id: generationId },
          data: {
            floorArea: measurements.floorArea,
            wallArea: measurements.wallArea,
            roomWidth: measurements.roomWidth,
            roomLength: measurements.roomLength,
            roomHeight: measurements.roomHeight,
          },
        });
      }

      return NextResponse.json({
        floorArea: measurements.floorArea,
        wallArea: measurements.wallArea,
        roomWidth: measurements.roomWidth,
        roomLength: measurements.roomLength,
        roomHeight: measurements.roomHeight,
        roomType: measurements.roomType,
        confidence: measurements.confidence,
        notes: measurements.notes,
        cached: false,
        source: "gemini",
      });
    }

    // ---- No measurement API available ----
    return NextResponse.json({ error: "No measurement API configured", noApi: true }, { status: 501 });
  } catch (error) {
    console.error("[Measure] Error:", error);
    const message = error instanceof Error ? error.message : "Measurement failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
