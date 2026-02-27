import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";

interface FieldFeedback {
  found: boolean;
  confidence: "high" | "medium" | "low" | "none";
  message: string;
}

interface ScrapeResult {
  name: string | null;
  logoUrl: string | null;
  logoSvg: string | null;
  logoIsLight: boolean;
  kennitala: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  description: string | null;
  // Per-field feedback for the UI
  feedback: {
    name: FieldFeedback;
    logo: FieldFeedback;
    kennitala: FieldFeedback;
    primaryColor: FieldFeedback;
    secondaryColor: FieldFeedback;
  };
}

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    // Fetch the page
    const res = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "is,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Gat ekki sótt vefsíðu (${res.status})` }, { status: 400 });
    }

    const rawHtml = await res.text();
    const baseUrl = new URL(normalizedUrl);
    const origin = baseUrl.origin;

    // Fetch external CSS stylesheets and append to HTML for color analysis
    // This catches colors defined in separate .css files (very common)
    let externalCss = "";
    try {
      const cssLinks = [...rawHtml.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi),
                         ...rawHtml.matchAll(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi)];
      const cssUrls = [...new Set(cssLinks.map(m => {
        let href = m[1];
        if (href.startsWith("//")) href = "https:" + href;
        else if (href.startsWith("/")) href = origin + href;
        else if (!href.startsWith("http")) href = origin + "/" + href;
        return href;
      }))].slice(0, 5); // Max 5 stylesheets

      const cssResults = await Promise.allSettled(
        cssUrls.map(u => fetch(u, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000),
        }).then(r => r.ok ? r.text() : ""))
      );
      for (const r of cssResults) {
        if (r.status === "fulfilled" && r.value) externalCss += r.value + "\n";
      }
    } catch { /* ignore CSS fetch errors */ }

    // Combine HTML + external CSS for analysis
    const html = rawHtml + "\n" + externalCss;

    const result: ScrapeResult = {
      name: null,
      logoUrl: null,
      logoSvg: null,
      logoIsLight: false,
      kennitala: null,
      primaryColor: null,
      secondaryColor: null,
      description: null,
      feedback: {
        name: { found: false, confidence: "none", message: "Fannst ekki" },
        logo: { found: false, confidence: "none", message: "Fannst ekki" },
        kennitala: { found: false, confidence: "none", message: "Fannst ekki" },
        primaryColor: { found: false, confidence: "none", message: "Fannst ekki" },
        secondaryColor: { found: false, confidence: "none", message: "Fannst ekki" },
      },
    };

    // --- Extract company name ---
    // 1. og:site_name
    const ogSiteName = extractMeta(html, "og:site_name");
    // 2. og:title
    const ogTitle = extractMeta(html, "og:title");
    // 3. <title> tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const titleText = titleMatch?.[1] ? decodeHTMLEntities(titleMatch[1].trim()) : undefined;
    // 4. h1 tag (often the company name on homepages)
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const h1Text = h1Match?.[1] ? decodeHTMLEntities(h1Match[1].trim()) : undefined;
    // 5. Try to get name from domain as last resort
    const domainName = baseUrl.hostname.replace(/^www\./, "").split(".")[0];
    const capitalizedDomain = domainName.charAt(0).toUpperCase() + domainName.slice(1);

    // Generic page titles that should NOT be used as company name
    const genericPageTitles = new Set([
      "forsíða", "heim", "heima", "home", "homepage", "front page", "main page",
      "welcome", "velkomin", "upphafssíða", "index", "startseite", "accueil",
      "hem", "start", "hovedside", "forside", "etusivu", "página principal",
    ]);

    // Helper: extract best name from a title string (handle separators + generic parts)
    const extractNameFromTitle = (text: string): string | null => {
      const parts = text.split(/\s*[|\-–—:]\s*/).map(p => p.trim()).filter(p => p.length > 1);
      if (parts.length === 0) return null;
      // Try first part (common: "Company | Page Title")
      if (!genericPageTitles.has(parts[0].toLowerCase()) && parts[0].length < 60) {
        return parts[0];
      }
      // Try last part (common: "Forsíða | Company" or "Home - Company")
      const last = parts[parts.length - 1];
      if (parts.length > 1 && !genericPageTitles.has(last.toLowerCase()) && last.length < 60) {
        return last;
      }
      // All parts are generic → return null
      return null;
    };

    // Prefer og:site_name > cleaned title > og:title > h1 > domain
    if (ogSiteName) {
      // og:site_name often includes tagline ("Company - Tagline") — clean it
      const cleanedSiteName = extractNameFromTitle(ogSiteName);
      if (cleanedSiteName) {
        result.name = cleanedSiteName;
        result.feedback.name = { found: true, confidence: "high", message: "Úr og:site_name" };
      }
    }
    if (!result.name && titleText) {
      const cleaned = extractNameFromTitle(titleText);
      if (cleaned) {
        result.name = cleaned;
        result.feedback.name = { found: true, confidence: "medium", message: "Úr titli síðu — athugaðu" };
      }
    }
    if (!result.name && ogTitle) {
      const cleaned = extractNameFromTitle(ogTitle);
      if (cleaned) {
        result.name = cleaned;
        result.feedback.name = { found: true, confidence: "medium", message: "Úr og:title — athugaðu" };
      }
    }
    // Detect promotional h1 content (discounts, offers, sales) — not company names
    const isPromotionalText = (text: string): boolean => {
      if (/%/.test(text)) return true; // "20% afsláttur"
      if (/^\d/.test(text)) return true; // Starts with number
      const promoWords = /\b(afsláttur|tilboð|sale|discount|offer|deal|free|ókeypis|verð|price|shipping|frí\s*sending|nýtt|new\s+arriv)/i;
      return promoWords.test(text);
    };

    if (!result.name && h1Text && h1Text.length < 40 && !genericPageTitles.has(h1Text.toLowerCase()) && !isPromotionalText(h1Text)) {
      result.name = h1Text;
      result.feedback.name = { found: true, confidence: "medium", message: "Úr fyrirsögn (h1) — athugaðu" };
    }

    // If still no name, use domain (capitalized)
    if (!result.name && capitalizedDomain.length > 1) {
      result.name = capitalizedDomain;
      result.feedback.name = { found: true, confidence: "low", message: "Dregið af léni — líklega rétt" };
    }

    // --- Extract logo ---
    // Strategy: logos are ALWAYS in the header/nav. Focus there first, then fall back.
    const ogImage = extractMeta(html, "og:image");

    // ── Step 1: Extract header/nav block robustly ──
    // Use greedy matching for header since lazy can under-match nested elements
    const headerBlockMatch = rawHtml.match(/<header[^>]*>([\s\S]*?)<\/header>/i);
    const headerBlock = headerBlockMatch ? headerBlockMatch[0] : "";
    // Some sites have multiple navs — grab ALL of them in the top portion
    const navBlocks: string[] = [];
    const navRegex = /<nav[^>]*>[\s\S]*?<\/nav>/gi;
    let navM;
    while ((navM = navRegex.exec(rawHtml)) !== null) {
      navBlocks.push(navM[0]);
      if (navBlocks.length >= 5) break; // safety limit
    }
    const allNavContent = navBlocks.join("\n");
    // Combine header + all navs + first 30KB of HTML as the "top block"
    const topBlock = headerBlock + "\n" + allNavContent + "\n" + rawHtml.slice(0, 30000);

    // Helper to decode Next.js /_next/image URLs and HTML entities
    const decodeImgUrl = (url: string): string => {
      let decoded = url.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
      const nextMatch = decoded.match(/\/_next\/image\?url=([^&]+)/);
      if (nextMatch?.[1]) {
        decoded = decodeURIComponent(nextMatch[1]);
      }
      return decoded;
    };

    // Helper to extract best image source from an img tag (handles srcset, data-src, lazy loading)
    const extractBestSrc = (imgTag: string): string | null => {
      // Try srcset first for higher res
      const srcsetMatch = imgTag.match(/srcset=["']([^"']+)["']/i);
      if (srcsetMatch?.[1]) {
        const decoded = srcsetMatch[1].replace(/&amp;/g, "&");
        const sources = decoded.split(",").map(s => s.trim().split(/\s+/));
        const best = sources.sort((a, b) => {
          const aW = parseInt(a[1] || "0");
          const bW = parseInt(b[1] || "0");
          return bW - aW;
        })[0];
        if (best?.[0]) return decodeImgUrl(best[0]);
      }
      // Try data-src / data-lazy-src (lazy-loaded images)
      const dataSrcMatch = imgTag.match(/data-(?:lazy-)?src=["']([^"']+)["']/i);
      if (dataSrcMatch?.[1] && !dataSrcMatch[1].includes("data:image/svg+xml")) {
        return decodeImgUrl(dataSrcMatch[1]);
      }
      // Standard src
      const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
      if (srcMatch?.[1] && !srcMatch[1].includes("data:image/svg+xml;base64,PHN2Zy")) {
        return decodeImgUrl(srcMatch[1]);
      }
      // Placeholder SVG src — check data-src as actual source
      if (srcMatch?.[1]) return decodeImgUrl(srcMatch[1]);
      return null;
    };

    // Helper: extract src from <picture> element (source + img)
    const extractPictureSrc = (pictureTag: string): string | null => {
      // Try <source> with type="image/webp" or similar
      const sourceMatch = pictureTag.match(/<source[^>]*srcset=["']([^"',\s]+)/i);
      if (sourceMatch?.[1]) return decodeImgUrl(sourceMatch[1]);
      // Fall back to <img> inside picture
      const imgInPicture = pictureTag.match(/<img[^>]*>/i);
      if (imgInPicture) return extractBestSrc(imgInPicture[0]);
      return null;
    };

    // Helper: check if SVG is a valid logo (not a tiny icon)
    const isValidLogoSvg = (svg: string): boolean => {
      const widthMatch = svg.match(/width=["'](\d+)/i);
      const heightMatch = svg.match(/height=["'](\d+)/i);
      const svgW = widthMatch ? parseInt(widthMatch[1]) : 0;
      const svgH = heightMatch ? parseInt(heightMatch[1]) : 0;
      // Skip SVGs smaller than 24px — these are UI icons
      if ((svgW > 0 && svgW < 24) || (svgH > 0 && svgH < 24)) return false;
      // Check viewBox
      const vbMatch = svg.match(/viewBox=["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/i);
      if (vbMatch && parseFloat(vbMatch[1]) < 20 && parseFloat(vbMatch[2]) < 20) return false;
      // Skip icon library classes
      if (/lucide|heroicon|feather|fa-|bi-/i.test(svg)) return false;
      // Skip hamburger menu icons (3 lines/rects)
      const pathCount = (svg.match(/<(?:path|rect|line|circle)/gi) || []).length;
      if (pathCount <= 3 && svgW > 0 && svgW <= 30) return false;
      return true;
    };

    // ── Step 2: Try inline SVG logos in header/nav ──
    const svgSearchPatterns = [
      // SVG inside link to home page (most common logo pattern)
      /<a[^>]*href=["'](?:\/|https?:\/\/[^"']+)["'][^>]*>\s*(<svg[\s\S]*?<\/svg>)/i,
      // SVG inside element with logo/brand in class/id
      /<[^>]*(?:class|id)=["'][^"']*(?:logo|brand|site-logo|custom-logo)[^"']*["'][^>]*>[\s\S]*?(<svg[\s\S]*?<\/svg>)/i,
      // SVG directly inside a link with logo/brand in class
      /<a[^>]*(?:class|id)=["'][^"']*(?:logo|brand)[^"']*["'][^>]*>[\s\S]*?(<svg[\s\S]*?<\/svg>)/i,
      // Any SVG in the header/nav that's not tiny
      /(<svg[\s\S]*?<\/svg>)/i,
    ];

    // Search in header block first, then nav blocks, then top block
    const svgSearchAreas = [headerBlock, allNavContent, topBlock].filter(Boolean);
    let foundSvgLogo = false;
    for (const searchArea of svgSearchAreas) {
      if (foundSvgLogo) break;
      for (const pattern of svgSearchPatterns) {
        const svgMatch = searchArea.match(pattern);
        if (svgMatch?.[1]) {
          let svg = svgMatch[1].trim();
          if (!isValidLogoSvg(svg)) continue;
          if (!svg.includes('xmlns=')) {
            svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
          }
          result.logoSvg = svg;
          result.logoIsLight = isSvgLight(svg);
          const encoded = Buffer.from(svg).toString("base64");
          result.logoUrl = `data:image/svg+xml;base64,${encoded}`;
          result.feedback.logo = { found: true, confidence: "high", message: "SVG logo úr haus vefsíðu" };
          foundSvgLogo = true;
          break;
        }
      }
    }

    // ── Step 3: Look for img-based logos — prioritize header/nav ──
    if (!result.logoSvg) {
      const logoCandidates: { url: string; priority: number; source: string }[] = [];

      // --- Priority 0 (HIGHEST): img with "logo" class/alt/id INSIDE header/nav ---
      // This is the #1 most reliable pattern
      const headerNavBlock = headerBlock + "\n" + allNavContent;
      if (headerNavBlock) {
        // All img tags in header/nav
        const headerImgRegex = /<img[^>]*>/gi;
        let him;
        while ((him = headerImgRegex.exec(headerNavBlock)) !== null) {
          const tag = him[0];
          const src = extractBestSrc(tag);
          if (!src) continue;
          // Check if this img has "logo" anywhere in its attributes
          if (/logo|brand|site-logo|custom-logo/i.test(tag)) {
            logoCandidates.push({ url: src, priority: 0, source: "Logo img í haus" });
          }
        }

        // <picture> elements in header with logo
        const headerPicRegex = /<picture[^>]*>[\s\S]*?<\/picture>/gi;
        let hpm;
        while ((hpm = headerPicRegex.exec(headerNavBlock)) !== null) {
          const picTag = hpm[0];
          if (/logo|brand/i.test(picTag)) {
            const src = extractPictureSrc(picTag);
            if (src) logoCandidates.push({ url: src, priority: 0, source: "Picture logo í haus" });
          }
        }

        // <a href="/"> containing <img> in header (logo links to homepage)
        const homeLinkImgPatterns = [
          /<a[^>]*href=["']\/["'][^>]*>[\s\S]*?<img([^>]*)>/gi,
          /<a[^>]*href=["']https?:\/\/[^"']*["'][^>]*>[\s\S]*?<img([^>]*)>/gi,
        ];
        for (const pat of homeLinkImgPatterns) {
          let hlm;
          while ((hlm = pat.exec(headerNavBlock)) !== null) {
            const imgAttrs = hlm[1];
            const fullImgTag = `<img${imgAttrs}>`;
            const src = extractBestSrc(fullImgTag);
            if (src) {
              // Higher priority if it also says "logo"
              const prio = /logo|brand/i.test(fullImgTag) ? 0 : 1;
              logoCandidates.push({ url: src, priority: prio, source: "Mynd í heimasíðu-tengli í haus" });
            }
          }
        }

        // First <img> in header (even without "logo" — it's almost always the logo)
        const firstHeaderImg = headerNavBlock.match(/<img([^>]*)>/i);
        if (firstHeaderImg) {
          const src = extractBestSrc(`<img${firstHeaderImg[1]}>`);
          if (src) logoCandidates.push({ url: src, priority: 1, source: "Fyrsta mynd í haus" });
        }
      }

      // --- Priority 1: WordPress/WooCommerce/Shopify specific patterns ---
      const cmsPatterns = [
        // WordPress: <img class="custom-logo" ...>
        /<img[^>]*class=["'][^"']*custom-logo[^"']*["'][^>]*>/gi,
        // WordPress: <img class="site-logo" ...>
        /<img[^>]*class=["'][^"']*site-logo[^"']*["'][^>]*>/gi,
        // WordPress: element with wp-custom-logo class
        /class=["'][^"']*wp-custom-logo[^"']*["'][^>]*>[\s\S]*?<img([^>]*)>/gi,
        // Shopify: <img class="header__logo-image" ...>
        /<img[^>]*class=["'][^"']*header__logo[^"']*["'][^>]*>/gi,
      ];
      for (const pattern of cmsPatterns) {
        let cm;
        while ((cm = pattern.exec(rawHtml)) !== null) {
          const tag = cm[0];
          // For patterns that capture img attrs separately
          const imgTag = tag.startsWith("<img") ? tag : `<img${cm[1] || ""}>`;
          const src = extractBestSrc(imgTag.includes("src=") ? imgTag : tag);
          if (src) logoCandidates.push({ url: src, priority: 1, source: "CMS logo mynd" });
        }
      }

      // --- Priority 2: Any img with "logo" anywhere in HTML ---
      const imgTagRegex = /<img[^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgTagRegex.exec(rawHtml)) !== null) {
        const tag = imgMatch[0];
        if (/logo/i.test(tag)) {
          const src = extractBestSrc(tag);
          if (src) logoCandidates.push({ url: src, priority: 2, source: "Mynd með 'logo' í nafni" });
        }
      }

      // --- Priority 2: img in logo/brand container ---
      const logoContainerPatterns = [
        /<(?:a|div|span|figure)[^>]*(?:class|id)=["'][^"']*(?:logo|brand|site-logo)[^"']*["'][^>]*>[\s\S]*?<img([^>]*)>/gi,
      ];
      for (const pattern of logoContainerPatterns) {
        let m;
        while ((m = pattern.exec(rawHtml)) !== null) {
          const src = extractBestSrc(`<img${m[1]}>`);
          if (src) logoCandidates.push({ url: src, priority: 2, source: "Mynd úr logo-ílátinu" });
        }
      }

      // --- Priority 3: CSS background-image with "logo" context ---
      const bgLogoPatterns = [
        /(?:class|id)=["'][^"']*logo[^"']*["'][^>]*style=["'][^"']*background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi,
        /\.logo[^{]*\{[^}]*background(?:-image)?:\s*url\(["']?([^"')]+)["']?\)/gi,
      ];
      for (const pattern of bgLogoPatterns) {
        let m;
        while ((m = pattern.exec(html)) !== null) {
          if (m[1]) logoCandidates.push({ url: m[1], priority: 3, source: "CSS bakgrunnsmynd logo" });
        }
      }

      // --- Priority 4: SVG favicon (high quality) ---
      const svgIconPatterns = [
        /<link[^>]*rel=["']icon["'][^>]*type=["']image\/svg\+xml["'][^>]*href=["']([^"']+)["']/i,
        /<link[^>]*href=["']([^"']+\.svg)["'][^>]*rel=["']icon["']/i,
      ];
      for (const pattern of svgIconPatterns) {
        const m = rawHtml.match(pattern);
        if (m?.[1]) logoCandidates.push({ url: m[1], priority: 4, source: "SVG favicon" });
      }

      // --- Priority 5: Apple touch icon ---
      const appleTouchPatterns = [
        /<link[^>]*rel=["']apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i,
        /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon[^"']*["']/i,
      ];
      for (const pattern of appleTouchPatterns) {
        const m = rawHtml.match(pattern);
        if (m?.[1]) logoCandidates.push({ url: m[1], priority: 5, source: "Apple touch icon" });
      }

      // --- Priority 6: Large sized favicon ---
      const iconSizePatterns = [
        /<link[^>]*rel=["']icon["'][^>]*sizes=["'](\d+)x\d+["'][^>]*href=["']([^"']+)["']/i,
        /<link[^>]*href=["']([^"']+)["'][^>]*rel=["']icon["'][^>]*sizes=["'](\d+)x\d+["']/i,
      ];
      for (const pattern of iconSizePatterns) {
        const m = rawHtml.match(pattern);
        if (m) {
          const size = parseInt(m[1]) || parseInt(m[2]);
          const href = m[2] || m[1];
          if (size >= 128 && href && !/^\d+$/.test(href)) {
            logoCandidates.push({ url: href, priority: 6, source: "Stórt favicon" });
          }
        }
      }

      // --- Priority 7: og:image ---
      if (ogImage) logoCandidates.push({ url: ogImage, priority: 7, source: "og:image" });

      // --- Priority 8: Standard fallback paths ---
      logoCandidates.push(
        { url: "/favicon.svg", priority: 8, source: "Sjálfgefin slóð" },
        { url: "/logo.svg", priority: 8, source: "Sjálfgefin slóð" },
        { url: "/logo.png", priority: 8, source: "Sjálfgefin slóð" },
      );

      // Sort by priority, deduplicate, and resolve
      logoCandidates.sort((a, b) => a.priority - b.priority);

      const seen = new Set<string>();
      for (const { url: candidate, priority, source } of logoCandidates) {
        const normalized = candidate.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);

        // Skip tiny favicons, data URIs, tracking pixels
        if (/favicon.*\.ico$/i.test(normalized)) continue;
        if (normalized.startsWith("data:")) continue;
        if (/1x1|pixel|spacer|blank/i.test(normalized)) continue;

        let resolvedUrl = normalized;
        if (resolvedUrl.startsWith("//")) {
          resolvedUrl = "https:" + resolvedUrl;
        } else if (resolvedUrl.startsWith("/")) {
          resolvedUrl = origin + resolvedUrl;
        } else if (!resolvedUrl.startsWith("http")) {
          resolvedUrl = origin + "/" + resolvedUrl;
        }

        // Verify reachability
        try {
          const logoRes = await fetch(resolvedUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
          if (logoRes.ok) {
            const contentType = logoRes.headers.get("content-type") || "";
            if (contentType.includes("image") || contentType.includes("svg") || /\.(svg|png|jpg|jpeg|webp|gif)(\?|$)/i.test(resolvedUrl)) {
              result.logoUrl = resolvedUrl;

              // Confidence mapping
              const confidence: "high" | "medium" | "low" = priority <= 1 ? "high" : priority <= 3 ? "medium" : "low";
              // Skip og:image and fallback paths as final result — keep trying
              if (priority >= 7) continue;
              result.feedback.logo = { found: true, confidence, message: source };

              // Check if SVG is light
              if (/\.svg/i.test(resolvedUrl) || contentType.includes("svg")) {
                try {
                  const svgRes = await fetch(resolvedUrl, { signal: AbortSignal.timeout(5000) });
                  const svgText = await svgRes.text();
                  if (svgText.includes("<svg")) {
                    result.logoIsLight = isSvgLight(svgText);
                  }
                } catch { /* skip */ }
              }
              break;
            }
          }
        } catch { /* skip unreachable */ }
      }
    } // end if (!result.logoSvg)

    // --- Extract kennitala ---
    // Icelandic kennitala format: 6 digits, optional dash/space, 4 digits
    // Often preceded by "kt.", "kennitala", "kt:", etc.
    const ktPatterns = [
      /(?:kt\.?|kennitala|kt:)[:\s]*(\d{6}[\s-]?\d{4})/i,
      // In footer or contact sections
      /(?:footer|bottom|contact)[\s\S]{0,2000}?(\d{6}-\d{4})/i,
      /(\d{6}-\d{4})/,  // Standard format with dash anywhere
    ];
    for (const pattern of ktPatterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        // Normalize to 000000-0000 format
        const digits = match[1].replace(/[\s-]/g, "");
        if (digits.length === 10) {
          // Basic kennitala validation: first 6 digits should be a plausible date or company number
          const dd = parseInt(digits.slice(0, 2));
          const mm = parseInt(digits.slice(2, 4));
          // Company kennitala starts with 4-7 in first digit of day
          const isCompanyKt = dd >= 41 && dd <= 71;
          const isPersonKt = dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12;
          if (isCompanyKt || isPersonKt) {
            result.kennitala = digits.slice(0, 6) + "-" + digits.slice(6);
            result.feedback.kennitala = { found: true, confidence: "high", message: "Fundin á vefsíðu" };
            break;
          }
        }
      }
    }

    // --- Extract brand colors ---
    const colors: { hex: string; weight: number }[] = [];

    // Build a CSS variable map from :root { --var: value } declarations
    // Skip WordPress preset colors (--wp--preset--color--*) which are generic defaults
    const cssVarMap: Record<string, string> = {};
    const rootVarMatches = html.matchAll(/--([a-zA-Z0-9_-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi);
    for (const m of rootVarMatches) {
      const varName = m[1];
      // Skip WordPress default presets — these are NOT brand colors
      if (/^wp--preset--(?:color|gradient)/i.test(varName)) continue;
      const n = normalizeColor(m[2]);
      if (n) cssVarMap[`--${varName}`] = n;
    }

    // Helper to resolve var() references or raw colors
    const resolveColor = (val: string): string | null => {
      const varRef = val.match(/var\(\s*(--[a-zA-Z0-9_-]+)\s*\)/i);
      if (varRef) return cssVarMap[varRef[1]] || null;
      return normalizeColor(val);
    };

    // 1. meta theme-color (medium-high priority)
    // Weight reduced: theme-color is often set to background/accent colors, not true brand color
    // Further reduced for pastel/very light colors (likely background tints, not brand)
    const themeColor = extractMeta(html, "theme-color");
    if (themeColor && isValidColor(themeColor)) {
      const n = normalizeColor(themeColor);
      if (n && !isBlackWhiteGray(n)) {
        const tcWeight = isPastelOrLight(n) ? 3 : 7;
        colors.push({ hex: n, weight: tcWeight });
      }
    }

    // 2. msapplication-TileColor (low weight — often wrong/legacy, auto-generated by tools)
    const tileColor = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
    if (tileColor?.[1] && isValidColor(tileColor[1])) {
      const n = normalizeColor(tileColor[1]);
      if (n && !isBlackWhiteGray(n)) colors.push({ hex: n, weight: 4 });
    }

    // 3. CSS custom properties — named brand-like variables (highest signal)
    // Deduplicate: same color from multiple var definitions (e.g. --primary + --primary-color) only counts once
    const brandVarPatterns = [
      /--(?:color-)?(?:primary|brand|main|accent|theme)(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
    ];
    const brandColorsSeen = new Set<string>();
    for (const pattern of brandVarPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = normalizeColor(match[1]);
        if (n && !isBlackWhiteGray(n) && !brandColorsSeen.has(n)) {
          brandColorsSeen.add(n);
          colors.push({ hex: n, weight: 9 });
        }
      }
    }

    // 3a. CTA / button background CSS variables (strongest brand signal — this is what users click)
    // Covers: --btn-bg-color, --button-background, --color-pr-button-background (Flatsome), etc.
    const ctaVarPatterns = [
      /--(?:btn|button)-(?:bg|background)(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
      /--color-(?:pr|em|primary|cta|action)-button-background(?:-hover)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
    ];
    const ctaColorsSeen = new Set<string>();
    for (const pattern of ctaVarPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = normalizeColor(match[1]);
        if (n && !isBlackWhiteGray(n) && !ctaColorsSeen.has(n)) {
          ctaColorsSeen.add(n);
          colors.push({ hex: n, weight: 12 });
        }
      }
    }

    // 3a2. Header/nav background CSS variables (strong visual brand signal)
    // Deduplicate: repeated definitions in media queries / Flatsome sections only count once
    const headerVarPatterns = [
      /--color-headers?-background:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
      /--(?:header|nav)-(?:bg|background)(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
    ];
    const headerColorsSeen = new Set<string>();
    for (const pattern of headerVarPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = normalizeColor(match[1]);
        // Only use if it's NOT a near-white/near-black background
        if (n && !isBlackWhiteGray(n) && !headerColorsSeen.has(n)) {
          headerColorsSeen.add(n);
          colors.push({ hex: n, weight: 7 });
        }
      }
    }

    // 3b. Secondary-type CSS variables
    // Deduplicate same as above
    const secondaryVarPatterns = [
      /--(?:color-)?(?:secondary|dark|nav|header|footer)(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
    ];
    const secondaryColorsSeen = new Set<string>();
    for (const pattern of secondaryVarPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = normalizeColor(match[1]);
        if (n && !isBlackWhiteGray(n) && !secondaryColorsSeen.has(n)) {
          secondaryColorsSeen.add(n);
          colors.push({ hex: n, weight: 6 });
        }
      }
    }

    // 4. Header/nav background colors in CSS rules (medium signal — header bg is often secondary/accent)
    // Match patterns like .dmHeader{background:#68ccd1} or .header{background-color:...}
    // Deduplicate: only count each unique color ONCE from header patterns
    const headerColors = new Set<string>();
    const headerCssPatterns = [
      /[.#](?:[a-zA-Z_-]*[Hh]eader[a-zA-Z_-]*)\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|var\([^)]+\))/gi,
      /[.#](?:[a-zA-Z_-]*[Nn]av(?:bar|igation)?[a-zA-Z_-]*)\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|var\([^)]+\))/gi,
      // Inline styles on header/nav elements
      /<(?:header|nav)[^>]*style=["'][^"']*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi,
    ];
    for (const pattern of headerCssPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = resolveColor(match[1]);
        if (n && !isBlackWhiteGray(n)) headerColors.add(n);
      }
    }
    for (const hc of headerColors) {
      colors.push({ hex: hc, weight: 6 });
    }

    // 5. Button background colors in CSS rules (strong brand signal — CTA color)
    // Deduplicate: same button color appearing in multiple rule variants counts once
    const buttonColorPatterns = [
      /\.(?:btn|button|cta)[a-zA-Z_-]*\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|var\([^)]+\))/gi,
      /button\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|var\([^)]+\))/gi,
    ];
    const buttonColorsSeen = new Set<string>();
    for (const pattern of buttonColorPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        const n = resolveColor(match[1]);
        if (n && !isBlackWhiteGray(n) && !buttonColorsSeen.has(n)) {
          buttonColorsSeen.add(n);
          colors.push({ hex: n, weight: 9 });
        }
      }
    }

    // 6. Background colors by frequency (both hex and rgba)
    // BUT first detect product swatch patterns: many unique inline background-colors
    // are product colors (cosmetics, paint, flooring), NOT brand colors
    const inlineBgColors = new Set<string>();
    const inlineBgColorMatches = html.matchAll(/style=["'][^"']*background-color:\s*(#[0-9a-fA-F]{3,8})/gi);
    for (const ibm of inlineBgColorMatches) {
      const n = normalizeColor(ibm[1]);
      if (n && !isBlackWhiteGray(n)) inlineBgColors.add(n);
    }
    const isProductSwatchPage = inlineBgColors.size > 8; // many unique inline bg colors = product listing

    const bgColorPatterns = [
      /background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/gi,
      /background(?:-color)?:\s*(rgba?\([^)]+\))/gi,
    ];
    const colorFrequency: Record<string, number> = {};
    for (const pattern of bgColorPatterns) {
      let m;
      while ((m = pattern.exec(html)) !== null) {
        const color = normalizeColor(m[1]);
        if (color && !isBlackWhiteGray(color)) {
          // If this is a product swatch page, skip colors that come from inline swatch styles
          if (isProductSwatchPage && inlineBgColors.has(color)) continue;
          colorFrequency[color] = (colorFrequency[color] || 0) + 1;
        }
      }
    }

    // Detect "uniform frequency" category/department palettes:
    // If 4+ colors share the EXACT same high frequency, they're likely department colors (e.g., red=hardware,
    // blue=plumbing, green=garden) — NOT brand colors. Down-weight them.
    const freqCounts: Record<number, string[]> = {};
    for (const [c, freq] of Object.entries(colorFrequency)) {
      if (freq >= 5) { // only track meaningful frequencies
        if (!freqCounts[freq]) freqCounts[freq] = [];
        freqCounts[freq].push(c);
      }
    }
    const uniformFreqColors = new Set<string>();
    for (const [, colorList] of Object.entries(freqCounts)) {
      if (colorList.length >= 4) {
        // 4+ colors with the same frequency = category palette, not brand
        colorList.forEach(c => uniformFreqColors.add(c));
      }
    }

    // Sort background colors by frequency — high frequency = brand color
    const sortedByFreq = Object.entries(colorFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    for (const [c, freq] of sortedByFreq) {
      if (uniformFreqColors.has(c)) {
        // Category/department color — very low weight
        colors.push({ hex: c, weight: 1 });
        continue;
      }
      // Scale weight by frequency: 2+ uses = weight 5, 5+ = weight 6, 10+ = weight 7
      const weight = freq >= 10 ? 7 : freq >= 5 ? 6 : freq >= 2 ? 5 : 3;
      colors.push({ hex: c, weight });
    }

    // 6b. Tailwind CSS arbitrary color classes: bg-[#hex], text-[#hex]
    // Very common in modern Next.js / Tailwind sites
    const tailwindBgColors: Record<string, number> = {};
    const tailwindBgPattern = /\bbg-\[#([0-9a-fA-F]{3,8})\]/g;
    let twMatch;
    while ((twMatch = tailwindBgPattern.exec(html)) !== null) {
      const hex = normalizeColor(`#${twMatch[1]}`);
      if (hex && !isBlackWhiteGray(hex)) {
        tailwindBgColors[hex] = (tailwindBgColors[hex] || 0) + 1;
      }
    }
    for (const [hex, count] of Object.entries(tailwindBgColors)) {
      // bg-[#color] used multiple times = strong brand signal
      const weight = count >= 3 ? 8 : count >= 2 ? 6 : 4;
      colors.push({ hex, weight });
    }

    // Also check Tailwind text colors (lower weight, but frequent = brand)
    const tailwindTextColors: Record<string, number> = {};
    const tailwindTextPattern = /\btext-\[#([0-9a-fA-F]{3,8})\]/g;
    while ((twMatch = tailwindTextPattern.exec(html)) !== null) {
      const hex = normalizeColor(`#${twMatch[1]}`);
      if (hex && !isBlackWhiteGray(hex)) {
        tailwindTextColors[hex] = (tailwindTextColors[hex] || 0) + 1;
      }
    }
    for (const [hex, count] of Object.entries(tailwindTextColors)) {
      const weight = count >= 5 ? 5 : count >= 2 ? 3 : 1;
      colors.push({ hex, weight });
    }

    // 6b2. Tailwind named bg-* utility class definitions in CSS
    // Matches: .bg-orange{...background-color:rgb(R G B/var(--tw-bg-opacity))}
    // These define the brand's named color palette in Tailwind config
    const twNamedBgPattern = /\.bg-([\w-]+)\{[^}]*background-color:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi;
    let twNamedMatch;
    const twNamedColors = new Map<string, string>(); // name → hex
    while ((twNamedMatch = twNamedBgPattern.exec(html)) !== null) {
      const name = twNamedMatch[1].toLowerCase();
      const n = normalizeColor(twNamedMatch[2]);
      if (!n || isBlackWhiteGray(n)) continue;
      // Skip generic utility names (white, black, gray, transparent, current, opacity-*)
      if (/^(white|black|gray|grey|slate|zinc|neutral|stone|transparent|current|inherit|opacity)/i.test(name)) continue;
      twNamedColors.set(name, n);
    }
    // Score named Tailwind colors — brand-like names get higher weight
    for (const [name, hex] of twNamedColors) {
      const isBrandName = /^(primary|brand|accent|main|theme|cta|action|highlight)/.test(name);
      // Count how many times this class is used in HTML class attributes
      const classUsagePattern = new RegExp(`\\bbg-${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      const usageCount = (html.match(classUsagePattern) || []).length;
      // Subtract 1 for the CSS definition itself
      const actualUsage = Math.max(0, usageCount - 1);
      if (isBrandName) {
        colors.push({ hex, weight: 10 });
      } else if (actualUsage >= 3) {
        colors.push({ hex, weight: 7 });
      } else if (actualUsage >= 1) {
        colors.push({ hex, weight: 5 });
      } else {
        // Defined but never used on the page — still hints at palette
        colors.push({ hex, weight: 2 });
      }
    }

    // 6b3. CSS ::selection / ::moz-selection background color — strong brand signal
    // Users see this when selecting text; sites deliberately set it to brand color
    const selectionPattern = /::(?:-moz-)?selection\s*\{[^}]*background(?:-color)?:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/gi;
    let selMatch;
    while ((selMatch = selectionPattern.exec(html)) !== null) {
      const n = normalizeColor(selMatch[1]);
      if (n && !isBlackWhiteGray(n)) colors.push({ hex: n, weight: 8 });
    }

    // 6c. Colors from CSS linear-gradient() and radial-gradient() — extract individual colors
    // Deduplicate: only count each gradient color ONCE (gradients repeat in HTML)
    const gradientColors = new Set<string>();
    const gradientPattern = /(?:linear|radial)-gradient\([^)]*\)/gi;
    let gradMatch;
    while ((gradMatch = gradientPattern.exec(html)) !== null) {
      const gradStr = gradMatch[0];
      const hexInGrad = gradStr.matchAll(/#[0-9a-fA-F]{3,8}/gi);
      for (const hm of hexInGrad) {
        const n = normalizeColor(hm[0]);
        if (n && !isBlackWhiteGray(n)) gradientColors.add(n);
      }
      const rgbaInGrad = gradStr.matchAll(/rgba?\([^)]+\)/gi);
      for (const rm of rgbaInGrad) {
        const n = normalizeColor(rm[0]);
        if (n && !isBlackWhiteGray(n)) gradientColors.add(n);
      }
    }
    // Gradient colors get low-medium weight — they're accent, not usually primary
    for (const gc of gradientColors) {
      colors.push({ hex: gc, weight: 3 });
    }

    // 6d. Inline style colors (style="...color:...") — catches React/Vue inline styles
    // If product swatch page, heavily down-weight inline background colors (they're product swatches)
    const inlineStyleColors = html.matchAll(/style=["'][^"']*(?:background-color|background|color):\s*(#[0-9a-fA-F]{3,8})/gi);
    for (const ism of inlineStyleColors) {
      const n = normalizeColor(ism[1]);
      if (n && !isBlackWhiteGray(n)) {
        const w = isProductSwatchPage && inlineBgColors.has(n) ? 0 : 4;
        if (w > 0) colors.push({ hex: n, weight: w });
      }
    }

    // 7. Link colors (lower weight — links are often different from brand)
    const linkColorPatterns = [
      /\ba\s*\{[^}]*color:\s*(#[0-9a-fA-F]{3,8})/i,
      /\ba\s*\{[^}]*color:\s*(rgba?\([^)]+\))/i,
    ];
    for (const pattern of linkColorPatterns) {
      const m = html.match(pattern);
      if (m) {
        const n = normalizeColor(m[1]);
        if (n && !isBlackWhiteGray(n)) colors.push({ hex: n, weight: 2 });
      }
    }

    // 8. CSS variables from :root that aren't matched above — numbered vars like --color_3
    // These are common in website builders (DudaMobile, Wix, etc.)
    for (const [varName, hex] of Object.entries(cssVarMap)) {
      if (!isBlackWhiteGray(hex)) {
        // Check if this variable is used in background-color: var(--name)
        const varUsed = html.includes(`background-color:${varName}`) ||
                        html.includes(`background-color: ${varName}`) ||
                        html.includes(`background:${varName}`) ||
                        html.includes(`background-color:var(${varName})`) ||
                        html.includes(`background-color: var(${varName})`);
        if (varUsed) {
          colors.push({ hex, weight: 5 });
        }
      }
    }

    // Aggregate: group by color, sum weights + track max single-signal weight
    const colorWeights: Record<string, number> = {};
    const colorMaxSignal: Record<string, number> = {};
    for (const { hex, weight } of colors) {
      colorWeights[hex] = (colorWeights[hex] || 0) + weight;
      colorMaxSignal[hex] = Math.max(colorMaxSignal[hex] || 0, weight);
    }

    // Sort by total weight, pick top 2 distinct colors
    const rankedColors = Object.entries(colorWeights)
      .sort((a, b) => b[1] - a[1]);

    // Determine color feedback confidence based on total weight and signal strength
    const getColorConfidence = (totalWeight: number, maxSignal: number): { confidence: "high" | "medium" | "low"; message: string } => {
      if (maxSignal >= 9) return { confidence: "high", message: "Sterk merki — CSS breyta eða CTA" };
      if (maxSignal >= 7 || totalWeight >= 15) return { confidence: "high", message: "Fundinn úr mörgum merkjum" };
      if (maxSignal >= 5 || totalWeight >= 10) return { confidence: "medium", message: "Fundinn en athugaðu" };
      return { confidence: "low", message: "Óvíst — athugaðu vel" };
    };

    // Minimum thresholds — don't set colors when confidence is too low
    // Primary: needs total weight >= 4 (at least one decent signal)
    // Secondary: needs total weight >= 5
    // Pastel/very light colors need higher thresholds — they're often background tints, not brand
    // Pastel colors need maxSignal >= 7 (strong CSS variable/CTA) to be trusted
    const getEffectiveThreshold = (hex: string, base: number): number => {
      // Pastel/very light colors are almost never real brand colors — they're background tints.
      // Require a very strong signal (CSS variable/CTA with weight 9+) to accept a pastel.
      if (isPastelOrLight(hex)) return Math.max(base, 15);
      return base;
    };

    if (rankedColors.length >= 1) {
      const [hex, total] = rankedColors[0];
      const threshold = getEffectiveThreshold(hex, 4);
      if (total >= threshold) {
        result.primaryColor = hex;
        const fb = getColorConfidence(total, colorMaxSignal[hex] || 0);
        result.feedback.primaryColor = { found: true, ...fb };
      }
    }
    // If the top color was pastel and filtered out, try next non-pastel color as primary
    if (!result.primaryColor) {
      for (const [hex, total] of rankedColors) {
        const threshold = getEffectiveThreshold(hex, 4);
        if (total < 4) break; // Below any threshold
        if (total >= threshold) {
          result.primaryColor = hex;
          const fb = getColorConfidence(total, colorMaxSignal[hex] || 0);
          result.feedback.primaryColor = { found: true, ...fb };
          break;
        }
      }
    }
    if (result.primaryColor && rankedColors.length >= 2) {
      // Find a second color that's visually distinct from the first
      for (let i = 0; i < rankedColors.length; i++) {
        const [hex, total] = rankedColors[i];
        if (hex === result.primaryColor) continue;
        const threshold = getEffectiveThreshold(hex, 5);
        if (total < 5) break; // Below any threshold
        if (total < threshold) continue; // Pastel below higher threshold
        if (areColorsDistinct(result.primaryColor, hex)) {
          result.secondaryColor = hex;
          const fb = getColorConfidence(total, colorMaxSignal[hex] || 0);
          result.feedback.secondaryColor = { found: true, ...fb };
          break;
        }
      }
    }

    // --- Extract description ---
    const metaDesc = extractMeta(html, "description") || extractMeta(html, "og:description");
    if (metaDesc) {
      result.description = metaDesc.slice(0, 200);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Scrape error:", error);
    return NextResponse.json({ error: "Villa við að sækja vefsíðu" }, { status: 500 });
  }
}

// --- Helper functions ---

/**
 * Decode HTML entities in a string (e.g. &oacute; → ó, &#x27; → ', &#39; → ')
 */
function decodeHTMLEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
    "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&laquo;": "«", "&raquo;": "»",
    "&copy;": "©", "&reg;": "®", "&trade;": "™", "&euro;": "€",
    // Icelandic/Nordic characters
    "&aacute;": "á", "&Aacute;": "Á", "&eacute;": "é", "&Eacute;": "É",
    "&iacute;": "í", "&Iacute;": "Í", "&oacute;": "ó", "&Oacute;": "Ó",
    "&uacute;": "ú", "&Uacute;": "Ú", "&yacute;": "ý", "&Yacute;": "Ý",
    "&thorn;": "þ", "&THORN;": "Þ", "&eth;": "ð", "&ETH;": "Ð",
    "&aelig;": "æ", "&AElig;": "Æ", "&ouml;": "ö", "&Ouml;": "Ö",
    "&aring;": "å", "&Aring;": "Å", "&oslash;": "ø", "&Oslash;": "Ø",
    "&ntilde;": "ñ", "&Ntilde;": "Ñ", "&uuml;": "ü", "&Uuml;": "Ü",
    "&auml;": "ä", "&Auml;": "Ä", "&ccedil;": "ç", "&Ccedil;": "Ç",
    "&szlig;": "ß", "&agrave;": "à", "&egrave;": "è", "&igrave;": "ì",
    "&ograve;": "ò", "&ugrave;": "ù", "&atilde;": "ã", "&otilde;": "õ",
    "&acirc;": "â", "&ecirc;": "ê", "&icirc;": "î", "&ocirc;": "ô", "&ucirc;": "û",
  };
  // Named entities
  let result = text.replace(/&[a-zA-Z]+;/g, (entity) => namedEntities[entity] || namedEntities[entity.toLowerCase()] || entity);
  // Numeric entities (decimal): &#39; &#243;
  result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)));
  // Numeric entities (hex): &#x27; &#xF3;
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return result;
}

function extractMeta(html: string, nameOrProperty: string): string | null {
  // Try property="..." first (Open Graph), then name="..."
  const patterns = [
    new RegExp(`<meta[^>]*property="${nameOrProperty}"[^>]*content="([^"]*)"`, "i"),
    new RegExp(`<meta[^>]*content="([^"]*)"[^>]*property="${nameOrProperty}"`, "i"),
    new RegExp(`<meta[^>]*name="${nameOrProperty}"[^>]*content="([^"]*)"`, "i"),
    new RegExp(`<meta[^>]*content="([^"]*)"[^>]*name="${nameOrProperty}"`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHTMLEntities(match[1].trim());
  }
  return null;
}

function isValidColor(color: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(color) || /^rgba?\(/i.test(color);
}

function normalizeColor(color: string): string | null {
  color = color.trim().toLowerCase();
  // Convert 3-digit hex to 6-digit
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }
  if (/^#[0-9a-f]{6}$/.test(color)) {
    return color;
  }
  // Handle 8-digit hex (with alpha) — strip alpha channel, e.g. #919EAB14 → #919EAB
  if (/^#[0-9a-f]{8}$/.test(color)) {
    return color.slice(0, 7);
  }
  // Handle 4-digit hex (with alpha) — expand to 6 and strip alpha
  if (/^#[0-9a-f]{4}$/.test(color)) {
    return "#" + color[1] + color[1] + color[2] + color[2] + color[3] + color[3];
  }
  // Handle rgb() and rgba()
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/);
  if (rgbMatch) {
    const r = Math.min(255, parseInt(rgbMatch[1])).toString(16).padStart(2, "0");
    const g = Math.min(255, parseInt(rgbMatch[2])).toString(16).padStart(2, "0");
    const b = Math.min(255, parseInt(rgbMatch[3])).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return null;
}

/**
 * Check if a color is pastel/very light (high lightness, low saturation).
 * These are typically background tints, not true brand colors.
 * e.g. #ffddbf (peach) is L=87% → pastel. #ff7800 (orange) is L=50% → NOT pastel.
 */
function isPastelOrLight(hex: string): boolean {
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return false;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  // Colors with L > 0.78 are too light to be strong brand colors
  return lightness > 0.78;
}

function isBlackWhiteGray(hex: string): boolean {
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Check if it's very close to gray (all channels similar) and either very dark or very light
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  // If low saturation (grayish) OR very dark/light
  if (saturation < 0.15) return true;
  if (max < 40) return true;   // Very dark
  if (min > 220) return true;  // Very light
  return false;
}

/**
 * Check if two hex colors are visually distinct enough to be used as primary/secondary.
 */
function areColorsDistinct(hex1: string, hex2: string): boolean {
  if (!hex1 || !hex2) return true;
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  // Euclidean distance in RGB space
  const distance = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  // Minimum distance of ~60 (out of max ~441) for colors to be considered distinct
  return distance > 60;
}

/**
 * Analyze an SVG string to determine if the logo is predominantly white/light.
 * Checks fill and stroke attributes for white-ish colors.
 * A logo is "light" if most of its visible colors are white/near-white.
 */
function isSvgLight(svg: string): boolean {
  // Extract all fill and stroke color values from the SVG
  const colorAttrs = [
    ...Array.from(svg.matchAll(/fill=["']([^"']+)["']/gi)).map(m => m[1]),
    ...Array.from(svg.matchAll(/stroke=["']([^"']+)["']/gi)).map(m => m[1]),
    // Also check inline style fill/stroke
    ...Array.from(svg.matchAll(/fill:\s*([^;"']+)/gi)).map(m => m[1].trim()),
    ...Array.from(svg.matchAll(/stroke:\s*([^;"']+)/gi)).map(m => m[1].trim()),
  ];

  if (colorAttrs.length === 0) return false;

  // Filter out "none", "transparent", "currentColor", and URLs (gradients)
  const meaningfulColors = colorAttrs.filter(c => {
    const lower = c.toLowerCase().trim();
    return lower !== "none" && lower !== "transparent" && lower !== "currentcolor" && !lower.startsWith("url(");
  });

  if (meaningfulColors.length === 0) return false;

  let lightCount = 0;
  let totalCount = 0;

  for (const color of meaningfulColors) {
    const lower = color.toLowerCase().trim();
    totalCount++;

    // Check named white colors
    if (lower === "white" || lower === "#fff" || lower === "#ffffff" || lower === "#ffff" || lower === "#ffffffff") {
      lightCount++;
      continue;
    }

    // Normalize and check hex colors
    const normalized = normalizeColor(lower);
    if (normalized) {
      const r = parseInt(normalized.slice(1, 3), 16);
      const g = parseInt(normalized.slice(3, 5), 16);
      const b = parseInt(normalized.slice(5, 7), 16);
      // If the color is very light (close to white)
      if (r > 220 && g > 220 && b > 220) {
        lightCount++;
      }
    }
  }

  // Logo is "light" if more than 60% of its colors are white/near-white
  return totalCount > 0 && (lightCount / totalCount) > 0.6;
}
