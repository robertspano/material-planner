/**
 * Generate default studio backgrounds for the Car Clipper app
 * Run with: npx tsx scripts/generate-backgrounds.ts
 */
import sharp from "sharp";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const WIDTH = 1920;
const HEIGHT = 1080;
const OUTPUT_DIR = path.join(process.cwd(), "public", "backgrounds");

async function generateGradientBackground(
  name: string,
  topColor: [number, number, number],
  bottomColor: [number, number, number],
  vignetteStrength: number = 0.3
) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);

  const centerX = WIDTH / 2;
  const centerY = HEIGHT * 0.4;

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;

      // Vertical gradient
      const t = y / HEIGHT;

      // Base color from gradient
      let r = topColor[0] + (bottomColor[0] - topColor[0]) * t;
      let g = topColor[1] + (bottomColor[1] - topColor[1]) * t;
      let b = topColor[2] + (bottomColor[2] - topColor[2]) * t;

      // Vignette effect
      const dx = (x - centerX) / WIDTH;
      const dy = (y - centerY) / HEIGHT;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const vignette = 1 - dist * vignetteStrength;
      const vClamped = Math.max(0.6, Math.min(1, vignette));

      r = Math.round(r * vClamped);
      g = Math.round(g * vClamped);
      b = Math.round(b * vClamped);

      pixels[i] = Math.max(0, Math.min(255, r));
      pixels[i + 1] = Math.max(0, Math.min(255, g));
      pixels[i + 2] = Math.max(0, Math.min(255, b));
    }
  }

  const buffer = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();

  const outputPath = path.join(OUTPUT_DIR, name);
  await writeFile(outputPath, buffer);
  console.log(`Generated: ${outputPath}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Background 1: Classic light gray studio
  await generateGradientBackground(
    "studio-light.jpg",
    [210, 210, 215],  // Light gray top
    [165, 165, 170],  // Medium gray bottom (floor)
    0.35
  );

  // Background 2: Dark moody studio
  await generateGradientBackground(
    "studio-dark.jpg",
    [55, 60, 70],     // Dark blue-gray top
    [30, 32, 38],     // Very dark bottom
    0.5
  );

  // Background 3: Warm white studio
  await generateGradientBackground(
    "studio-warm.jpg",
    [235, 230, 220],  // Warm white top
    [195, 185, 175],  // Warm gray bottom
    0.25
  );

  // Background 4: Showroom blue
  await generateGradientBackground(
    "studio-blue.jpg",
    [40, 55, 85],     // Dark blue top
    [25, 30, 45],     // Darker blue bottom
    0.45
  );

  // Background 5: Clean white
  await generateGradientBackground(
    "studio-white.jpg",
    [245, 245, 248],  // Near white top
    [210, 212, 218],  // Light gray bottom
    0.2
  );

  // Background 6: Luxury dark
  await generateGradientBackground(
    "studio-luxury.jpg",
    [35, 35, 40],     // Very dark top
    [18, 18, 22],     // Near black bottom
    0.6
  );

  // Default fallback
  await generateGradientBackground(
    "default-studio.jpg",
    [200, 200, 205],
    [155, 155, 160],
    0.3
  );

  console.log("\nAll backgrounds generated successfully!");
}

main().catch(console.error);
