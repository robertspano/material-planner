/**
 * Wizart Vision API integration for room measurement.
 *
 * Sends a room photo to Wizart's /interior/ endpoint and gets back
 * 3D reconstruction data: wall dimensions, floor area, doors, windows.
 *
 * Docs: https://docs.vision-api.wizart.ai/
 * API host: https://pim-client.wizart.ai/vision-api/v3
 */

const WIZART_API_HOST = "https://pim-client.wizart.ai/vision-api/v3";

export interface WallMeasurement {
  wallId: number;
  width: number;   // meters
  height: number;  // meters
  area: number;    // m²
}

export interface OpeningMeasurement {
  id: number;
  wallId: number;
  width: number;   // meters
  height: number;  // meters
  area: number;    // m²
}

export interface RoomMeasurements {
  floorArea: number;      // m²
  wallArea: number;       // m² (total wall - doors - windows)
  totalWallArea: number;  // m² (total wall without subtracting)
  roomHeight: number;     // meters (average wall height)
  walls: WallMeasurement[];
  windows: OpeningMeasurement[];
  doors: OpeningMeasurement[];
  roomType: string | null;       // e.g. "living_room", "bedroom"
  confidence: number;     // image quality score 0-1
}

/**
 * Measure a room from a photo using Wizart Vision API.
 * Returns floor area, wall area, and dimensions in meters.
 */
export async function measureRoom(imageBuffer: Buffer): Promise<RoomMeasurements> {
  const apiKey = process.env.WIZART_API_KEY;
  if (!apiKey) {
    throw new Error("WIZART_API_KEY not configured");
  }

  // Build multipart form with the image
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" });
  formData.append("room_image", blob, "room.jpg");

  console.log("[Wizart] Sending image to API...", imageBuffer.length, "bytes");

  const response = await fetch(`${WIZART_API_HOST}/interior/`, {
    method: "POST",
    headers: {
      "Authorization": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[Wizart] API error:", response.status, errorText);
    throw new Error(`Wizart API error: ${response.status} ${errorText.substring(0, 200)}`);
  }

  const data = await response.json();
  console.log("[Wizart] API response received");

  return parseWizartResponse(data);
}

/**
 * Parse the Wizart API response into our structured measurements.
 */
function parseWizartResponse(data: any): RoomMeasurements {
  const reconstruction = data.reconstruction || {};
  const analysis = data.analysis || {};

  // Parse walls
  const walls: WallMeasurement[] = (reconstruction.walls || []).map((w: any) => ({
    wallId: w.wall_id,
    width: round(w.width),
    height: round(w.height),
    area: round(w.area),
  }));

  // Parse windows
  const windows: OpeningMeasurement[] = (reconstruction.windows || []).map((w: any) => ({
    id: w.window_id || 0,
    wallId: w.wall_id || 0,
    width: round(w.width),
    height: round(w.height),
    area: round(w.area),
  }));

  // Parse doors
  const doors: OpeningMeasurement[] = (reconstruction.doors || []).map((d: any) => ({
    id: d.door_id || 0,
    wallId: d.wall_id || 0,
    width: round(d.width),
    height: round(d.height),
    area: round(d.area),
  }));

  // Calculate floor area
  const floors = reconstruction.floors || [];
  const floorArea = floors.reduce((sum: number, f: any) => sum + (f.area || 0), 0);

  // Calculate wall areas
  const totalWallArea = walls.reduce((sum, w) => sum + w.area, 0);
  const windowArea = windows.reduce((sum, w) => sum + w.area, 0);
  const doorArea = doors.reduce((sum, d) => sum + d.area, 0);
  const wallArea = totalWallArea - windowArea - doorArea;

  // Average room height from walls
  const roomHeight = walls.length > 0
    ? walls.reduce((sum, w) => sum + w.height, 0) / walls.length
    : 2.5; // default 2.5m

  // Image quality confidence
  const imageInfo = analysis.image_info || {};
  const confidence = 1 - (imageInfo.bad_target_confidence || 0);

  return {
    floorArea: round(floorArea),
    wallArea: round(Math.max(0, wallArea)),
    totalWallArea: round(totalWallArea),
    roomHeight: round(roomHeight),
    walls,
    windows,
    doors,
    roomType: analysis.interior_type || null,
    confidence: round(confidence),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch an image from URL or local path and return as Buffer.
 */
export async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  if (imageUrl.startsWith("/uploads/") || imageUrl.startsWith("/placeholder")) {
    const fs = await import("fs/promises");
    const path = await import("path");
    const filePath = path.join(process.cwd(), "public", imageUrl);
    const data = await fs.readFile(filePath);
    return Buffer.from(data);
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
