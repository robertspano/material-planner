import { NextRequest, NextResponse } from "next/server";
import { getCompanyFromRequest } from "@/lib/tenant";

export async function POST(request: NextRequest) {
  try {
    const company = await getCompanyFromRequest();
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const { email, pdfUrl, productNames, combinedTotal } = await request.json();

    if (!email || !pdfUrl) {
      return NextResponse.json({ error: "Email and pdfUrl are required" }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "\u00D3gilt netfang" }, { status: 400 });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return NextResponse.json({ error: "P\u00F3st\u00FEj\u00F3nusta er ekki stillt" }, { status: 503 });
    }

    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);

    const productsText = Array.isArray(productNames) && productNames.length > 0
      ? productNames.join(", ")
      : "Tilbo\u00F0";

    const fromDomain = process.env.RESEND_FROM_DOMAIN || "snid.is";
    const fromEmail = `tilbod@${fromDomain}`;

    await resend.emails.send({
      from: `${company.name} <${fromEmail}>`,
      to: email,
      subject: `Tilbo\u00F0 - ${productsText}`,
      text: `Tilbo\u00F0 fr\u00E1 ${company.name}\n\nV\u00F6rur: ${productsText}${combinedTotal && combinedTotal > 0 ? `\n\u00C1\u00E6tla\u00F0ur kostna\u00F0ur: ${Math.round(combinedTotal).toLocaleString("is-IS")} kr` : ""}\n\nSmelltu \u00E1 hlekkinn h\u00E9r a\u00F0 ne\u00F0an til a\u00F0 s\u00E6kja tilbo\u00F0i\u00F0:\n${pdfUrl}\n\nMe\u00F0 kve\u00F0ju,\n${company.name}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
          <div style="background: ${company.primaryColor || "#2e7cff"}; height: 4px; border-radius: 4px; margin-bottom: 24px;"></div>

          ${company.logoUrl
            ? `<img src="${company.logoUrl}" alt="${company.name}" style="height: 40px; margin-bottom: 20px;" />`
            : `<h2 style="color: ${company.primaryColor || "#2e7cff"}; margin: 0 0 20px 0;">${company.name}</h2>`
          }

          <h1 style="color: #1e293b; font-size: 22px; margin: 0 0 8px 0;">Tilbo\u00F0</h1>
          <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
            V\u00F6rur: ${productsText}
          </p>

          ${combinedTotal && combinedTotal > 0
            ? `<div style="background: ${company.primaryColor || "#2e7cff"}; color: white; padding: 16px 20px; border-radius: 12px; margin-bottom: 24px;">
                <p style="font-size: 12px; opacity: 0.8; margin: 0 0 4px 0;">\u00C1\u00E6tla\u00F0ur kostna\u00F0ur</p>
                <p style="font-size: 24px; font-weight: 700; margin: 0;">${Math.round(combinedTotal).toLocaleString("is-IS")} kr</p>
              </div>`
            : ""
          }

          <a href="${pdfUrl}"
             style="display: inline-block; background: ${company.primaryColor || "#2e7cff"}; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
            Opna tilbo\u00F0 (PDF)
          </a>

          <p style="color: #94a3b8; font-size: 12px; margin-top: 32px;">
            Me\u00F0 kve\u00F0ju, ${company.name}
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
