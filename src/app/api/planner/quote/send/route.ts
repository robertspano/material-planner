import { NextRequest, NextResponse } from "next/server";
import { getCompanyFromRequest } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { v2 as cloudinary } from "cloudinary";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const contentType = request.headers.get("content-type") || "";

    let email: string;
    let pdfUrl: string;
    let productNames: string[];
    let combinedTotal: number | null;

    if (contentType.includes("multipart/form-data")) {
      // New flow: client sends PDF blob + metadata as FormData
      const formData = await request.formData();
      email = formData.get("email") as string;
      productNames = JSON.parse(formData.get("productNames") as string || "[]");
      combinedTotal = parseFloat(formData.get("combinedTotal") as string) || null;
      const pdfFile = formData.get("pdf") as File;

      if (!email || !pdfFile) {
        return NextResponse.json({ error: "Email and PDF are required" }, { status: 400 });
      }

      // Upload PDF to Cloudinary
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        return NextResponse.json({ error: "Cloudinary ekki stillt" }, { status: 503 });
      }
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());
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
        uploadStream.end(pdfBuffer);
      });
      pdfUrl = uploadResult.secure_url;

      // Save Quote record
      await prisma.quote.create({
        data: {
          companyId: company.id,
          pdfUrl,
          items: [],
          combinedTotal,
          productNames,
        },
      }).catch(err => console.error("[Quote] DB save error:", err));

    } else {
      // Legacy JSON flow
      const body = await request.json();
      email = body.email;
      pdfUrl = body.pdfUrl;
      productNames = body.productNames || [];
      combinedTotal = body.combinedTotal || null;

      if (!email || !pdfUrl) {
        return NextResponse.json({ error: "Email and pdfUrl are required" }, { status: 400 });
      }
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Ógilt netfang" }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "Póstþjónusta er ekki stillt" }, { status: 503 });
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);

    const productsText = Array.isArray(productNames) && productNames.length > 0
      ? productNames.join(", ")
      : "Tilboð";

    const fromDomain = process.env.RESEND_FROM_DOMAIN || "snid.is";
    const fromEmail = `tilbod@${fromDomain}`;

    await resend.emails.send({
      from: `${company.name} <${fromEmail}>`,
      to: email,
      subject: `Tilboð - ${productsText}`,
      text: `Tilboð frá ${company.name}\n\nVörur: ${productsText}${combinedTotal && combinedTotal > 0 ? `\nÁætlaður kostnaður: ${Math.round(combinedTotal).toLocaleString("is-IS")} kr` : ""}\n\nSmelltu á hlekkinn hér að neðan til að sækja tilboðið:\n${pdfUrl}\n\nMeð kveðju,\n${company.name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="background: ${company.primaryColor || "#2e7cff"}; height: 4px; border-radius: 4px; margin-bottom: 24px;"></div>

          ${company.logoUrl
            ? `<img src="${company.logoUrl}" alt="${company.name}" style="height: 40px; margin-bottom: 20px;" />`
            : `<h2 style="color: ${company.primaryColor || "#2e7cff"}; margin: 0 0 20px 0;">${company.name}</h2>`
          }

          <h1 style="color: #1e293b; font-size: 22px; margin: 0 0 8px 0;">Tilboð</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
            Vörur: ${productsText}
          </p>

          ${combinedTotal && combinedTotal > 0
            ? `<div style="background: ${company.primaryColor || "#2e7cff"}; color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 24px;">
                <p style="font-size: 12px; opacity: 0.8; margin: 0 0 4px 0;">Áætlaður kostnaður</p>
                <p style="font-size: 24px; font-weight: 700; margin: 0;">${Math.round(combinedTotal).toLocaleString("is-IS")} kr</p>
              </div>`
            : ""
          }

          <a href="${pdfUrl}"
             style="display: inline-block; background: ${company.primaryColor || "#2e7cff"}; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Opna tilboð (PDF)
          </a>

          <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
            Með kveðju, ${company.name}
          </p>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Send quote error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
