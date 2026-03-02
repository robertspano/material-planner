import { NextRequest, NextResponse } from "next/server";
import { getCompanyFromRequest } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import { waitUntil } from "@vercel/functions";

// Allow up to 120 seconds for PDF generation
export const maxDuration = 120;

interface QuoteItem {
  productName: string;
  surfaceType: "floor" | "wall" | "both";
  price: number | null;
  discountPercent?: number | null;
  unit: string;
  tileWidth?: number | null;
  tileHeight?: number | null;
  area: number;
  totalNeeded: number;
  unitPrice: number | null;
  totalPrice: number;
  resultImageUrl?: string;
  roomImageUrl?: string;
  index: number;
}

interface QuoteRequest {
  companySlug: string;
  items: QuoteItem[];
  combinedTotal: number | null;
  // Legacy single-item format (backwards compatible)
  product?: { name: string; price: number | null; discountPercent?: number | null; unit: string };
  surfaceType?: string;
  area?: number;
  totalNeeded?: number;
  unitPrice?: number | null;
  totalPrice?: number | null;
  resultImageUrl?: string;
  roomImageUrl?: string;
}

function fU(u: string): string {
  return ({ m2: "m²", m3: "m³" } as Record<string, string>)[u] || u;
}

function fP(n: number): string {
  return n.toLocaleString("is-IS");
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : { r: 46, g: 124, b: 255 };
}

function lightenColor(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr},${lg},${lb})`;
}

async function fetchImageBase64(url: string, maxWidth = 800): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const rawBuf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/png";
    // Resize large images for PDF embedding (saves ~80% on large photos)
    const meta = await sharp(rawBuf).metadata();
    if (meta.width && meta.width > maxWidth) {
      const resized = await sharp(rawBuf).resize(maxWidth, undefined, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
      return `data:image/jpeg;base64,${resized.toString("base64")}`;
    }
    if (mime.includes("svg")) {
      const pngBuf = await sharp(rawBuf).png().toBuffer();
      return `data:image/png;base64,${pngBuf.toString("base64")}`;
    }
    return `data:${mime};base64,${rawBuf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const data: QuoteRequest = await request.json();

    // Normalize to items array (support legacy single-item format)
    let items: QuoteItem[] = data.items || [];
    if (items.length === 0 && data.product) {
      items = [{
        productName: data.product.name,
        surfaceType: (data.surfaceType as "floor" | "wall" | "both") || "floor",
        price: data.product.price,
        discountPercent: data.product.discountPercent,
        unit: data.product.unit,
        area: data.area || 0,
        totalNeeded: data.totalNeeded || 0,
        unitPrice: data.unitPrice ?? null,
        totalPrice: data.totalPrice || 0,
        resultImageUrl: data.resultImageUrl,
        roomImageUrl: data.roomImageUrl,
        index: 1,
      }];
    }

    const combinedTotal = data.combinedTotal ?? items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);

    const today = new Date().toLocaleDateString("is-IS", {
      year: "numeric", month: "long", day: "numeric",
    });

    const pc = company.primaryColor || "#2e7cff";
    const sc = company.secondaryColor || "#1e293b";
    const { r, g, b } = hexToRgb(pc);
    const brandRgb = `rgb(${r},${g},${b})`;
    const brandLight = lightenColor(pc, 0.92);

    // Fetch logo + first result/room images in parallel
    const imagePromises: Promise<string | null>[] = [
      company.logoUrl ? fetchImageBase64(company.logoUrl) : Promise.resolve(null),
    ];
    // Fetch up to 2 result images and 1 room image for page 2
    const firstResult = items.find(it => it.resultImageUrl);
    const secondResult = items.length > 1 ? items.find((it, i) => i > 0 && it.resultImageUrl) : undefined;
    if (firstResult?.resultImageUrl) imagePromises.push(fetchImageBase64(firstResult.resultImageUrl));
    else imagePromises.push(Promise.resolve(null));
    if (secondResult?.resultImageUrl) imagePromises.push(fetchImageBase64(secondResult.resultImageUrl));
    else imagePromises.push(Promise.resolve(null));
    if (firstResult?.roomImageUrl) imagePromises.push(fetchImageBase64(firstResult.roomImageUrl));
    else imagePromises.push(Promise.resolve(null));

    const [logoB64, result1B64, result2B64, roomB64] = await Promise.all(imagePromises);

    const { renderToBuffer } = await import("@react-pdf/renderer");
    const React = (await import("react")).default;
    const { Document, Page, View, Text, Image, StyleSheet } = await import("@react-pdf/renderer");
    const e = React.createElement;

    const s = StyleSheet.create({
      // Pages
      page: { fontFamily: "Helvetica", backgroundColor: "#ffffff", position: "relative" as const, paddingBottom: 60 },
      page2: { fontFamily: "Helvetica", backgroundColor: "#ffffff", position: "relative" as const, paddingBottom: 60 },

      // ===== TOP HEADER =====
      topBar: { height: 5, backgroundColor: brandRgb },
      header: {
        paddingHorizontal: 40,
        paddingTop: 28,
        paddingBottom: 20,
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      logoImg: { height: 40, maxWidth: 200 },
      companyName: { fontSize: 20, fontWeight: 700, color: brandRgb },
      headerRight: { alignItems: "flex-end" as const },
      quoteLabel: { fontSize: 20, fontWeight: 700, color: brandRgb },
      dateText: { fontSize: 9, color: "#64748b", marginTop: 3 },

      // ===== DIVIDER =====
      divider: { height: 2, backgroundColor: brandRgb, marginHorizontal: 40, opacity: 0.15 },
      dividerBold: { height: 2, backgroundColor: brandRgb, marginHorizontal: 40 },

      // ===== ITEM SECTION =====
      itemSection: { paddingHorizontal: 40, paddingTop: 22 },
      itemHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        marginBottom: 12,
      },
      itemBadge: {
        backgroundColor: brandRgb,
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        marginRight: 10,
      },
      itemBadgeText: { fontSize: 8, color: "#ffffff", fontWeight: 700 },
      itemTitle: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
      itemSubtitle: { fontSize: 9, color: "#94a3b8", marginTop: 2 },

      // ===== TABLE =====
      table: { borderRadius: 8, overflow: "hidden" as const, border: "1 solid #e2e8f0" },
      tableHead: {
        flexDirection: "row" as const,
        backgroundColor: brandRgb,
        paddingVertical: 9,
        paddingHorizontal: 14,
      },
      thText: { fontSize: 8, color: "#ffffff", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" as const },
      row: { flexDirection: "row" as const, paddingVertical: 9, paddingHorizontal: 14, borderBottom: "1 solid #f1f5f9" },
      rowAlt: { flexDirection: "row" as const, paddingVertical: 9, paddingHorizontal: 14, borderBottom: "1 solid #f1f5f9", backgroundColor: "#fafbfc" },
      rowLabel: { flex: 1, fontSize: 10, color: "#475569" },
      rowValue: { fontSize: 10, fontWeight: 700, color: "#1e293b", textAlign: "right" as const },
      rowDiscount: { flexDirection: "row" as const, paddingVertical: 9, paddingHorizontal: 14, backgroundColor: "#f0fdf4", borderBottom: "1 solid #dcfce7" },
      discountLabel: { flex: 1, fontSize: 10, color: "#059669", fontWeight: 600 },
      discountVal: { fontSize: 10, fontWeight: 700, color: "#059669" },
      strikePrice: { fontSize: 9, color: "#94a3b8", textDecoration: "line-through" as const, marginRight: 6 },
      // Item total row
      itemTotalRow: {
        flexDirection: "row" as const,
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: brandLight,
      },
      itemTotalLabel: { flex: 1, fontSize: 11, fontWeight: 700, color: brandRgb },
      itemTotalVal: { fontSize: 11, fontWeight: 700, color: brandRgb },

      // ===== COMBINED TOTAL =====
      totalBox: {
        marginHorizontal: 40,
        marginTop: 24,
        backgroundColor: brandRgb,
        borderRadius: 10,
        paddingVertical: 16,
        paddingHorizontal: 20,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
      },
      totalLabel: { fontSize: 13, fontWeight: 700, color: "#ffffff" },
      totalVal: { fontSize: 22, fontWeight: 700, color: "#ffffff" },

      // ===== FOOTER =====
      footer: {
        position: "absolute" as const,
        bottom: 0,
        left: 0,
        right: 0,
        height: 50,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        paddingHorizontal: 40,
        borderTop: "1 solid #f1f5f9",
      },
      footerLogoImg: { height: 18, maxWidth: 100 },
      footerText: { fontSize: 8, color: "#94a3b8" },
      footerRight: { fontSize: 7, color: "#cbd5e1" },

      // ===== PAGE 2: IMAGES =====
      p2Header: { paddingHorizontal: 40, paddingTop: 28, paddingBottom: 16 },
      p2Title: { fontSize: 18, fontWeight: 700, color: "#0f172a" },
      p2Sub: { fontSize: 10, color: "#94a3b8", marginTop: 4 },
      imagesArea: { paddingHorizontal: 40 },
      imgLabel: {
        fontSize: 8,
        color: brandRgb,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: "uppercase" as const,
        marginBottom: 6,
      },
      imgBox: { borderRadius: 8, overflow: "hidden" as const, border: "1 solid #e2e8f0", marginBottom: 18 },
      img: { width: "100%", height: 220, objectFit: "cover" as const },
      imgSmall: { width: "100%", height: 180, objectFit: "cover" as const },
    });

    // Helper to build a table row
    const tableRow = (label: string, value: string, alt: boolean) =>
      e(View, { style: alt ? s.rowAlt : s.row },
        e(Text, { style: s.rowLabel }, label),
        e(Text, { style: s.rowValue }, value)
      );

    // Build item sections
    const itemSections = items.map((item, idx) => {
      const unit = fU(item.unit || "m2");
      const hasDiscount = !!(item.discountPercent && item.price);
      const surfLabel = item.surfaceType === "floor" ? "Gólf" : item.surfaceType === "both" ? "Gólf og veggir" : "Veggir";

      return e(View, { key: idx, style: s.itemSection },
        // Item header
        e(View, { style: s.itemHeader },
          items.length > 1
            ? e(View, { style: s.itemBadge },
                e(Text, { style: s.itemBadgeText }, `#${item.index}`)
              )
            : null,
          e(View, { style: { flex: 1 } },
            e(Text, { style: s.itemTitle }, item.productName),
            e(Text, { style: s.itemSubtitle },
              `${surfLabel}${item.tileWidth && item.tileHeight ? ` • ${item.tileWidth}×${item.tileHeight} cm` : ""}`
            )
          )
        ),

        // Table
        e(View, { style: s.table },
          // Table header
          e(View, { style: s.tableHead },
            e(Text, { style: { ...s.thText, flex: 1 } }, "LÝSING"),
            e(Text, { style: s.thText }, "GILDI")
          ),
          tableRow("Yfirborð", surfLabel, false),
          tableRow("Flatarmál", item.area > 0 ? `${item.area.toFixed(1)} ${unit}` : "—", true),
          tableRow("Sóun (10%)", item.area > 0 ? `+${(item.area * 0.1).toFixed(1)} ${unit}` : "—", false),
          tableRow("Efni sem þarf", item.totalNeeded > 0 ? `${item.totalNeeded.toFixed(1)} ${unit}` : "—", true),
          // Unit price row
          item.unitPrice
            ? e(View, { style: s.row },
                e(Text, { style: s.rowLabel }, `Verð per ${unit}`),
                e(View, { style: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "flex-end" as const } },
                  hasDiscount && item.price
                    ? e(Text, { style: s.strikePrice }, `${fP(item.price)} kr`)
                    : null,
                  e(Text, { style: s.rowValue }, `${fP(item.unitPrice)} kr`)
                )
              )
            : null,
          // Discount row
          hasDiscount
            ? e(View, { style: s.rowDiscount },
                e(Text, { style: s.discountLabel }, "Afsláttur"),
                e(Text, { style: s.discountVal }, `-${item.discountPercent}%`)
              )
            : null,
          // Item total row
          item.totalPrice > 0
            ? e(View, { style: s.itemTotalRow },
                e(Text, { style: s.itemTotalLabel }, "Áætlað verð"),
                e(Text, { style: s.itemTotalVal }, `${fP(Math.round(item.totalPrice))} kr`)
              )
            : null,
        ),
      );
    });

    // ===== BUILD PDF DOCUMENT =====
    const doc = e(Document, {},
      // ============ PAGE 1: QUOTE ============
      e(Page, { size: "A4", style: s.page },
        // Top brand bar
        e(View, { style: s.topBar }),

        // Header: logo left + "TILBOÐ" right
        e(View, { style: s.header },
          logoB64
            ? e(Image, { src: logoB64, style: s.logoImg })
            : e(Text, { style: s.companyName }, company.name),
          e(View, { style: s.headerRight },
            e(Text, { style: s.quoteLabel }, "Tilboð"),
            e(Text, { style: s.dateText }, today)
          )
        ),

        // Divider
        e(View, { style: s.dividerBold }),

        // All item sections
        ...itemSections,

        // Combined total box
        combinedTotal && combinedTotal > 0
          ? e(View, { style: s.totalBox },
              e(Text, { style: s.totalLabel },
                items.length > 1 ? "Samtals áætlaður kostnaður" : "Áætlaður kostnaður"
              ),
              e(Text, { style: s.totalVal }, `${fP(Math.round(combinedTotal))} kr`)
            )
          : null,

        // Footer with logo
        e(View, { style: s.footer },
          logoB64
            ? e(Image, { src: logoB64, style: s.footerLogoImg })
            : e(Text, { style: s.footerText }, company.name),
          e(Text, { style: s.footerRight }, `Tilboð • ${today}`)
        )
      ),

      // ============ PAGE 2: IMAGES ============
      (result1B64 || roomB64)
        ? e(Page, { size: "A4", style: s.page2 },
            // Top brand bar
            e(View, { style: s.topBar }),

            // Header
            e(View, { style: s.p2Header },
              e(Text, { style: s.p2Title }, "Sjónræn sýn"),
              e(Text, { style: s.p2Sub },
                items.length === 1
                  ? `${items[0].productName}`
                  : `${items.length} vörur`
              )
            ),

            e(View, { style: s.divider }),

            // Images
            e(View, { style: { ...s.imagesArea, paddingTop: 16 } },
              // Result image 1
              result1B64
                ? e(View, {},
                    e(Text, { style: s.imgLabel },
                      items.length > 1
                        ? `NIÐURSTAÐA #1 — ${items[0]?.productName || ""}`
                        : "NIÐURSTAÐA"
                    ),
                    e(View, { style: s.imgBox },
                      e(Image, { src: result1B64, style: result2B64 || roomB64 ? s.imgSmall : s.img })
                    )
                  )
                : null,

              // Result image 2
              result2B64
                ? e(View, {},
                    e(Text, { style: s.imgLabel },
                      `NIÐURSTAÐA #2 — ${items[1]?.productName || ""}`
                    ),
                    e(View, { style: s.imgBox },
                      e(Image, { src: result2B64, style: s.imgSmall })
                    )
                  )
                : null,

              // Original room
              roomB64
                ? e(View, {},
                    e(Text, { style: s.imgLabel }, "UPPRUNALEGT HERBERGI"),
                    e(View, { style: s.imgBox },
                      e(Image, { src: roomB64, style: result2B64 ? s.imgSmall : s.imgSmall })
                    )
                  )
                : null,
            ),

            // Footer
            e(View, { style: s.footer },
              logoB64
                ? e(Image, { src: logoB64, style: s.footerLogoImg })
                : e(Text, { style: s.footerText }, company.name),
              e(Text, { style: s.footerRight }, `Tilboð • ${today}`)
            )
          )
        : null,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(doc as any);

    const filename = items.length === 1
      ? `tilbod-${items[0].productName.toLowerCase().replace(/\s+/g, "-")}.pdf`
      : "tilbod.pdf";

    // Upload PDF to Cloudinary (sync — needed for X-Quote-Url header)
    let pdfUrl: string | null = null;
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "planner-quotes",
              public_id: `quote-${company.slug}-${Date.now()}`,
              resource_type: "raw",
            },
            (error, result) => {
              if (error || !result) reject(error || new Error("Upload failed"));
              else resolve(result);
            }
          );
          uploadStream.end(Buffer.from(pdfBuffer));
        });
        pdfUrl = uploadResult.secure_url;
      }
    } catch (err) {
      console.error("[Quote] Cloudinary upload error:", err);
    }

    // Save Quote record in background (don't block the response)
    if (pdfUrl) {
      const savedPdfUrl = pdfUrl;
      waitUntil((async () => {
        try {
          const resultImageUrls = items
            .map(it => it.resultImageUrl)
            .filter((u): u is string => !!u);
          const productNames = items.map(it => it.productName);
          const firstRoomImage = items.find(it => it.roomImageUrl)?.roomImageUrl || null;

          await prisma.quote.create({
            data: {
              companyId: company.id,
              pdfUrl: savedPdfUrl,
              items: items as unknown as import("@prisma/client/runtime/library").JsonArray,
              combinedTotal: combinedTotal || null,
              roomImageUrl: firstRoomImage,
              resultImageUrls,
              productNames,
            },
          });
          console.log(`[Quote] Saved: ${savedPdfUrl}`);
        } catch (err) {
          console.error("[Quote] DB save error:", err);
        }
      })());
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    };
    if (pdfUrl) {
      headers["X-Quote-Url"] = pdfUrl;
      headers["Access-Control-Expose-Headers"] = "X-Quote-Url";
    }
    return new NextResponse(new Uint8Array(pdfBuffer), { headers });
  } catch (error) {
    console.error("Quote PDF error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
