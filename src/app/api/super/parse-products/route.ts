import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import * as XLSX from "xlsx";

// ── Types ───────────────────────────────────────────────────────────
type DetectedCategory = "flisar" | "parket" | "vinyl" | "annad";

interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  swatchUrl: string | null;
  tileWidth: number | null;
  tileHeight: number | null;
  tileThickness: number | null;
  discountPercent: number | null;
  color: string | null;
  description: string | null;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low";
  detectedCategory: DetectedCategory;
}

// ── Category Detection ──────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<Exclude<DetectedCategory, "annad">, RegExp> = {
  flisar: /fl[ií]s|tile|ceramic|keramik|porcel[aá]n|mosaic|mósaík|veggfl|gólffl|steingólf|stein(?:efni)?|marble|marmari/i,
  parket: /parket|parquet|hardwood|eik(?:ar)?[\s-]|oak|birki|birch|ash[\s-]|beech|plank|laminat|laminate|timbur|timber|viður|wood[\s-]?floor/i,
  vinyl: /vinyl|v[ií]nyl|lvt|spc|lin[oó]leum|pvc|click[\s-]?floor|luxury[\s-]?vinyl/i,
};

function detectCategory(texts: string[]): DetectedCategory {
  const combined = texts.filter(Boolean).join(" ").toLowerCase();
  for (const [cat, regex] of Object.entries(CATEGORY_KEYWORDS) as [string, RegExp][]) {
    if (regex.test(combined)) return cat as DetectedCategory;
  }
  return "annad";
}

// ── Column Detection ────────────────────────────────────────────────

// Map of header keywords → product field
const COLUMN_PATTERNS: Record<string, string[]> = {
  name: [
    "nafn", "name", "vara", "product", "vöru", "heiti", "titill", "title",
    "lýsing vöru", "product name", "item", "description", "vöruheiti",
  ],
  price: [
    "verð", "verd", "price", "cost", "kr", "isk", "útsöluverð", "unit price",
    "einingarverð", "verð m2", "verð/m2", "price/m2",
  ],
  imageUrl: [
    "mynd", "image", "img", "photo", "picture", "url", "link", "slóð",
    "image url", "myndaslóð", "product image",
  ],
  color: [
    "litur", "color", "colour", "litabrigði", "shade", "tint",
  ],
  width: [
    "breidd", "width", "w", "x", "vídd",
  ],
  height: [
    "hæð", "height", "h", "y", "lengd", "length",
  ],
  thickness: [
    "þykkt", "thickness", "t", "z", "depth",
  ],
  dimensions: [
    "stærð", "stærd", "size", "dimensions", "mál", "mal", "dim",
    "stærðir", "sizes", "flatarmál",
  ],
  description: [
    "lýsing", "lysing", "desc", "description", "athugasemd", "notes",
    "comment", "info", "upplýsingar",
  ],
  unit: [
    "eining", "unit", "mælieining",
  ],
  discount: [
    "afsláttur", "afslattur", "discount", "afsl", "afsl.",
    "afsláttur %", "discount %", "% afsláttur", "sala", "sale",
    "útsala", "utsala", "tilboð", "tilbod", "offer",
  ],
};

interface ColumnMapping {
  name: number;
  price: number;
  imageUrl: number;
  color: number;
  width: number;
  height: number;
  thickness: number;
  dimensions: number;
  description: number;
  unit: number;
  discount: number;
}

/** Try to match a header cell to a product field */
function matchColumn(header: string): string | null {
  const lower = header.toLowerCase().trim();
  if (!lower || lower.length > 60) return null;

  for (const [field, keywords] of Object.entries(COLUMN_PATTERNS)) {
    for (const keyword of keywords) {
      if (lower === keyword || lower.includes(keyword)) {
        return field;
      }
    }
  }
  return null;
}

/** Auto-detect column mapping from header row */
function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    name: -1,
    price: -1,
    imageUrl: -1,
    color: -1,
    width: -1,
    height: -1,
    thickness: -1,
    dimensions: -1,
    description: -1,
    unit: -1,
    discount: -1,
  };

  const used = new Set<number>();

  // First pass: exact/priority matches
  for (let i = 0; i < headers.length; i++) {
    const field = matchColumn(headers[i]);
    if (field && field in mapping && (mapping as unknown as Record<string, number>)[field] === -1) {
      (mapping as unknown as Record<string, number>)[field] = i;
      used.add(i);
    }
  }

  // If no name column found, use the first text-heavy column
  if (mapping.name === -1) {
    for (let i = 0; i < headers.length; i++) {
      if (!used.has(i) && headers[i].length > 0) {
        mapping.name = i;
        break;
      }
    }
  }

  return mapping;
}

// ── Price Parsing ───────────────────────────────────────────────────

function parsePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value > 0 ? value : null;

  const str = String(value).trim();
  // Remove currency labels and units
  let cleaned = str
    .replace(/kr\.?\s*\/?\s*m[²2]?/gi, "")
    .replace(/kr\.?/gi, "")
    .replace(/ISK/gi, "")
    .replace(/\/\s*stk\.?/gi, "")
    .replace(/,-/g, "")
    .replace(/[^\d.,\-]/g, "")
    .trim();

  if (!cleaned) return null;

  // Handle European format: 4.500,50
  const hasDecimalComma = /,\d{1,2}$/.test(cleaned);
  if (hasDecimalComma) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // Icelandic: dots/commas as thousands separators
    cleaned = cleaned.replace(/[.,\s]/g, "");
  }

  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0 || num > 10_000_000) return null;
  return num;
}

// ── Dimension Parsing ───────────────────────────────────────────────

function parseDimensions(text: string): {
  width: number | null;
  height: number | null;
  thickness: number | null;
} {
  const result = { width: null as number | null, height: null as number | null, thickness: null as number | null };
  if (!text) return result;

  const dimMatch = text.match(
    /(\d+(?:[.,]\d+)?)\s*[x×X]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×X]\s*(\d+(?:[.,]\d+)?))?\s*(mm|cm|m)?/i
  );
  if (!dimMatch) return result;

  let w = parseFloat(dimMatch[1].replace(",", "."));
  let h = parseFloat(dimMatch[2].replace(",", "."));
  let t = dimMatch[3] ? parseFloat(dimMatch[3].replace(",", ".")) : null;
  const unit = (dimMatch[4] || "").toLowerCase();

  // Normalize to cm
  if (unit === "mm" || w >= 100) {
    w = w / 10;
    h = h / 10;
  }
  if (unit === "m" && w < 10) {
    w = w * 100;
    h = h * 100;
  }

  result.width = Math.round(w * 10) / 10;
  result.height = Math.round(h * 10) / 10;
  if (t !== null) {
    if (t < 1 && unit !== "mm") t = t * 10;
    result.thickness = Math.round(t * 10) / 10;
  }

  return result;
}

function parseNumericDimension(value: unknown, isMm: boolean = false): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  if (isNaN(num) || num <= 0) return null;
  // If it looks like mm (>=100), convert to cm for width/height
  if (!isMm && num >= 100) return num / 10;
  return num;
}

// ── Row to Product ──────────────────────────────────────────────────

function rowToProduct(
  row: unknown[],
  mapping: ColumnMapping,
  rowIndex: number
): ScrapedProduct | null {
  const get = (idx: number): unknown => idx >= 0 && idx < row.length ? row[idx] : null;
  const getStr = (idx: number): string | null => {
    const v = get(idx);
    if (v === null || v === undefined || v === "") return null;
    return String(v).trim();
  };

  // Name is required
  const name = getStr(mapping.name);
  if (!name || name.length < 2) return null;

  // Skip obvious header rows that slipped through
  const nameLower = name.toLowerCase();
  if (nameLower === "nafn" || nameLower === "name" || nameLower === "vara" || nameLower === "product") return null;

  const price = parsePrice(get(mapping.price));
  const imageUrl = getStr(mapping.imageUrl);
  const color = getStr(mapping.color);
  const description = getStr(mapping.description);

  // Parse discount percentage
  let discountPercent: number | null = null;
  if (mapping.discount >= 0) {
    const discountVal = get(mapping.discount);
    if (discountVal !== null && discountVal !== undefined && discountVal !== "") {
      const discountStr = String(discountVal).replace(/%/g, "").replace(",", ".").trim();
      const parsed = parseFloat(discountStr);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
        discountPercent = parsed;
      }
    }
  }

  // Dimensions: try dedicated columns first, then "dimensions" text field
  let tileWidth: number | null = null;
  let tileHeight: number | null = null;
  let tileThickness: number | null = null;

  if (mapping.width >= 0) {
    tileWidth = parseNumericDimension(get(mapping.width));
  }
  if (mapping.height >= 0) {
    tileHeight = parseNumericDimension(get(mapping.height));
  }
  if (mapping.thickness >= 0) {
    tileThickness = parseNumericDimension(get(mapping.thickness), true);
  }

  // If no width/height from dedicated columns, try the "dimensions" field
  if (!tileWidth && !tileHeight && mapping.dimensions >= 0) {
    const dimText = getStr(mapping.dimensions);
    if (dimText) {
      const dims = parseDimensions(dimText);
      tileWidth = dims.width;
      tileHeight = dims.height;
      if (!tileThickness && dims.thickness) tileThickness = dims.thickness;
    }
  }

  // Also try parsing dimensions from the name or description
  if (!tileWidth && !tileHeight) {
    const combinedText = `${name} ${description || ""}`;
    const dims = parseDimensions(combinedText);
    tileWidth = dims.width;
    tileHeight = dims.height;
    if (!tileThickness && dims.thickness) tileThickness = dims.thickness;
  }

  // Determine confidence
  const hasImage = !!imageUrl && (imageUrl.startsWith("http") || imageUrl.startsWith("/"));
  const confidence: "high" | "medium" | "low" =
    hasImage && price ? "high" :
    hasImage || price ? "medium" : "low";

  return {
    name,
    price,
    currency: "ISK",
    imageUrl: hasImage ? imageUrl : null,
    swatchUrl: null,
    tileWidth,
    tileHeight,
    tileThickness,
    discountPercent,
    color,
    description: description ? description.slice(0, 300) : null,
    sourceUrl: null,
    confidence,
    detectedCategory: detectCategory([name, description || "", color || ""]),
  };
}

// ── Google Sheets / Docs URL Handling ────────────────────────────────

function isGoogleSheetsUrl(url: string): boolean {
  return /docs\.google\.com\/spreadsheets/.test(url);
}

function isGoogleDocsUrl(url: string): boolean {
  return /docs\.google\.com\/document/.test(url);
}

function getGoogleSheetsCsvUrl(url: string): string | null {
  // Extract spreadsheet ID
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const id = match[1];

  // Check for specific gid (sheet tab)
  const gidMatch = url.match(/gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

function getGoogleDocsHtmlUrl(url: string): string | null {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  return `https://docs.google.com/document/d/${match[1]}/export?format=html`;
}

// ── Parse from Google Sheets URL ────────────────────────────────────

async function parseFromGoogleSheets(url: string): Promise<{
  products: ScrapedProduct[];
  sheetName: string;
}> {
  const csvUrl = getGoogleSheetsCsvUrl(url);
  if (!csvUrl) throw new Error("Gat ekki lesið Google Sheets slóð");

  const res = await fetch(csvUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error("Gat ekki sótt Google Sheet — er það deilt (Share → Anyone with link)?");
  }

  const csvText = await res.text();
  const workbook = XLSX.read(csvText, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  return {
    products: parseRows(rows),
    sheetName: workbook.SheetNames[0] || "Sheet",
  };
}

// ── Parse from Google Docs URL ──────────────────────────────────────

async function parseFromGoogleDocs(url: string): Promise<{
  products: ScrapedProduct[];
  docName: string;
}> {
  const htmlUrl = getGoogleDocsHtmlUrl(url);
  if (!htmlUrl) throw new Error("Gat ekki lesið Google Docs slóð");

  const res = await fetch(htmlUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error("Gat ekki sótt Google Doc — er það deilt (Share → Anyone with link)?");
  }

  const html = await res.text();

  // Try to find tables in the HTML
  const workbook = XLSX.read(html, { type: "string" });
  if (workbook.SheetNames.length === 0) {
    throw new Error("Engar töflur fundust í skjalinu");
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  return {
    products: parseRows(rows),
    docName: "Google Doc",
  };
}

// ── Core Row Parser ─────────────────────────────────────────────────

function parseRows(rows: unknown[][]): ScrapedProduct[] {
  if (rows.length < 2) return [];

  // Find the header row (first row with 2+ non-empty cells)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const nonEmpty = (rows[i] || []).filter(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (nonEmpty.length >= 2) {
      headerIdx = i;
      break;
    }
  }

  const headers = (rows[headerIdx] || []).map(h => String(h || ""));
  const mapping = detectColumns(headers);

  // If we couldn't find a name column, give up
  if (mapping.name === -1) {
    // Try treating first column as name, second as price
    mapping.name = 0;
    if (headers.length > 1) mapping.price = 1;
  }

  const products: ScrapedProduct[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // Skip empty rows
    const nonEmpty = row.filter(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (nonEmpty.length === 0) continue;

    const product = rowToProduct(row, mapping, i);
    if (product) products.push(product);
  }

  return products;
}

// ── Main Handler ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const contentType = request.headers.get("content-type") || "";

    // ── Handle Google Sheets / Docs URL (JSON body) ──
    if (contentType.includes("application/json")) {
      const { url } = await request.json();
      if (!url) {
        return NextResponse.json({ error: "URL is required" }, { status: 400 });
      }

      if (isGoogleSheetsUrl(url)) {
        const { products, sheetName } = await parseFromGoogleSheets(url);
        return NextResponse.json({
          products,
          source: "google-sheets",
          pageTitle: sheetName,
          totalFound: products.length,
          warnings: products.length === 0
            ? ["Engar vörur fundust — athugaðu að fyrsta röðin þurfi að vera hausar (nafn, verð, stærð...)"]
            : [],
        });
      }

      if (isGoogleDocsUrl(url)) {
        const { products, docName } = await parseFromGoogleDocs(url);
        return NextResponse.json({
          products,
          source: "google-docs",
          pageTitle: docName,
          totalFound: products.length,
          warnings: products.length === 0
            ? ["Engar vörur fundust — skjalið þarf að innihalda töflu með vöruupplýsingum"]
            : [],
        });
      }

      return NextResponse.json({ error: "Ekki þekkt skjalaslóð" }, { status: 400 });
    }

    // ── Handle File Upload (FormData) ──
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Engin skrá valin" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    const validExts = [".xlsx", ".xls", ".csv", ".tsv", ".ods", ".numbers"];
    const isValid = validExts.some(ext => fileName.endsWith(ext));
    if (!isValid) {
      return NextResponse.json({
        error: `Skráarsnið ekki stutt. Leyfilegar skrár: ${validExts.join(", ")}`,
      }, { status: 400 });
    }

    // Validate size (max 20MB)
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "Skrá er of stór (hámark 20MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse with SheetJS
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer" });
    } catch {
      return NextResponse.json({ error: "Gat ekki lesið skrána — er hún rétt skráarsnið?" }, { status: 400 });
    }

    if (workbook.SheetNames.length === 0) {
      return NextResponse.json({ error: "Engin blöð fundust í skránni" }, { status: 400 });
    }

    // Parse the first sheet
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
    const products = parseRows(rows);

    // Build column info for the frontend (what we detected)
    const headerIdx = findHeaderRow(rows);
    const headers = (rows[headerIdx] || []).map(h => String(h || ""));
    const mapping = detectColumns(headers);
    const detectedColumns: Record<string, string> = {};
    for (const [field, idx] of Object.entries(mapping)) {
      if ((idx as number) >= 0 && (idx as number) < headers.length) {
        detectedColumns[field] = headers[idx as number];
      }
    }

    const warnings: string[] = [];
    if (products.length === 0) {
      warnings.push("Engar vörur fundust — athugaðu að fyrsta röðin þurfi að vera hausar");
    }
    if (workbook.SheetNames.length > 1) {
      warnings.push(`Skráin hefur ${workbook.SheetNames.length} blöð — aðeins fyrsta blaðið var lesið`);
    }
    if (mapping.imageUrl === -1) {
      warnings.push("Enginn dálkur fundinn fyrir myndir — vörur verða fluttar inn án mynda");
    }

    return NextResponse.json({
      products,
      source: "file-upload",
      pageTitle: file.name,
      totalFound: products.length,
      warnings,
      detectedColumns,
      sheetNames: workbook.SheetNames,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Parse products error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: `Villa: ${msg}` }, { status: 500 });
  }
}

/** Find the header row index */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const nonEmpty = (rows[i] || []).filter(c => c !== null && c !== undefined && String(c).trim() !== "");
    if (nonEmpty.length >= 2) return i;
  }
  return 0;
}
