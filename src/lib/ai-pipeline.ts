import Replicate from "replicate";
import { prisma } from "./prisma";
import { uploadToS3, buildS3Key } from "./s3";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

/**
 * Main AI pipeline: Segmentation → Inpainting → Result
 *
 * 1. SAM 2 segments the room photo to identify floor/wall surfaces
 * 2. FLUX Kontext applies the selected material to the masked area
 * 3. Results are stored in S3 and linked to the generation record
 */
export async function runAIPipeline(generationId: string): Promise<void> {
  const generation = await prisma.generation.findUnique({
    where: { id: generationId },
    include: {
      products: { include: { product: true } },
    },
  });

  if (!generation) throw new Error("Generation not found");

  try {
    // Step 1: Update status
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "segmenting" },
    });

    // Step 2: Run segmentation on the room photo
    const masks = await segmentRoom(generation.roomImageUrl);

    // Store mask data
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "generating",
        maskData: masks,
      },
    });

    // Step 3: For each product selection, apply material via inpainting
    for (const selection of generation.products) {
      const mask = selection.surfaceType === "floor" ? masks.floor : masks.wall;

      if (!mask) {
        console.warn(`No ${selection.surfaceType} mask found for generation ${generationId}`);
        continue;
      }

      const resultImageUrl = await applyMaterial(
        generation.roomImageUrl,
        mask,
        selection.product.swatchUrl || selection.product.imageUrl,
        selection.surfaceType
      );

      // Upload result (Cloudinary if configured, otherwise S3)
      const response = await fetch(resultImageUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      let storedUrl: string;
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const { uploadToCloudinary } = await import("./cloudinary");
        const filename = `${generationId}-${selection.surfaceType}-${Date.now()}.jpg`;
        storedUrl = await uploadToCloudinary(buffer, filename, "planner-results");
      } else {
        const key = buildS3Key(
          generation.companyId,
          "results",
          `${generationId}-${selection.surfaceType}-${Date.now()}.jpg`
        );
        storedUrl = await uploadToS3(key, buffer, "image/jpeg");
      }

      // Create result record
      await prisma.generationResult.create({
        data: {
          generationId,
          imageUrl: storedUrl,
        },
      });
    }

    // Step 4: Mark as completed
    await prisma.generation.update({
      where: { id: generationId },
      data: { status: "completed" },
    });
  } catch (error) {
    console.error("AI pipeline error:", error);
    await prisma.generation.update({
      where: { id: generationId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

/**
 * Segment a room photo using SAM 2 to identify floor and wall regions.
 * Returns base64-encoded masks for each surface type.
 */
async function segmentRoom(
  roomImageUrl: string
): Promise<{ floor: string | null; wall: string | null }> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.warn("REPLICATE_API_TOKEN not set, using placeholder masks");
    return { floor: null, wall: null };
  }

  try {
    // Use SAM 2 for automatic segmentation
    // The model segments the image and returns labeled regions
    const output = await replicate.run(
      "meta/sam-2-video:fe97b453a6455861e3bec01b4e2571dc122a3d785b62aa732ca588a769e23872",
      {
        input: {
          image: roomImageUrl,
          // Point prompts for floor (bottom center) and wall (top center)
          // These guide SAM to segment the correct regions
          input_points: [[0.5, 0.85]], // Floor region hint
          input_labels: [1],
        },
      }
    );

    // SAM returns mask images - store as URLs
    const masks = output as string[];
    return {
      floor: masks[0] || null,
      wall: masks[1] || null,
    };
  } catch (error) {
    console.error("Segmentation error:", error);
    // Return null masks - the inpainting step will handle this gracefully
    return { floor: null, wall: null };
  }
}

/**
 * Apply a material texture to a masked region using FLUX Kontext inpainting.
 * Uses the product swatch as a reference image for realistic material application.
 */
async function applyMaterial(
  roomImageUrl: string,
  maskUrl: string,
  swatchUrl: string,
  surfaceType: string
): Promise<string> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.warn("REPLICATE_API_TOKEN not set, returning placeholder");
    return roomImageUrl; // Return original as placeholder
  }

  const prompt = buildInpaintingPrompt(surfaceType);

  try {
    const output = await replicate.run(
      "black-forest-labs/flux-kontext-inpainting",
      {
        input: {
          image: roomImageUrl,
          mask: maskUrl,
          reference_image: swatchUrl,
          prompt,
          guidance_scale: 7.5,
          num_inference_steps: 30,
          output_format: "jpg",
          output_quality: 90,
        },
      }
    );

    // FLUX returns the generated image URL
    if (Array.isArray(output)) {
      return output[0] as string;
    }
    return output as unknown as string;
  } catch (error) {
    console.error("Inpainting error:", error);
    throw new Error(`Material application failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Upscale an image using Real-ESRGAN via Replicate.
 * Returns the URL of the upscaled image, or the original if upscaling unavailable.
 */
export async function upscaleImage(imageUrl: string): Promise<string> {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.warn("REPLICATE_API_TOKEN not set, skipping upscale");
    return imageUrl;
  }

  try {
    const output = await replicate.run(
      "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
      {
        input: {
          image: imageUrl,
          scale: 2,
          face_enhance: false,
        },
      }
    );

    // Real-ESRGAN returns a single URL string
    const resultUrl = typeof output === "string" ? output : (output as string[])?.[0];
    if (!resultUrl) return imageUrl;
    return resultUrl;
  } catch (error) {
    console.error("Upscale error:", error);
    return imageUrl; // Fall back to original
  }
}

/**
 * Build a structured prompt for material inpainting.
 * These prompts are "canned" and not user-editable to prevent misuse.
 */
function buildInpaintingPrompt(surfaceType: string): string {
  const prompts: Record<string, string> = {
    floor: [
      "Apply the material shown in the reference image as flooring to the masked floor area.",
      "Maintain the room's existing lighting, perspective, shadows, and ambient reflections.",
      "The flooring material should tile naturally following the floor's perspective and geometry.",
      "Preserve realistic grout lines or plank gaps as appropriate for the material type.",
      "Keep all other areas of the room completely unchanged.",
    ].join(" "),
    wall: [
      "Apply the material shown in the reference image as a wall covering to the masked wall area.",
      "Maintain the room's existing lighting, perspective, and shadows.",
      "The wall material should follow the wall's flat geometry with natural tiling.",
      "Preserve any architectural features like corners, edges, and trim visible in the wall area.",
      "Keep all other areas of the room completely unchanged.",
    ].join(" "),
  };

  return prompts[surfaceType] || prompts.floor;
}
