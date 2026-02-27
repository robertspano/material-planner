"use client";

export type TilingPattern = "straight" | "brick" | "herringbone" | "diagonal" | "chevron" | "stacked" | "one-third";

interface PatternOption {
  value: TilingPattern;
  label: string;
  description: string;
}

const PATTERN_INFO: Record<TilingPattern, PatternOption> = {
  straight: {
    value: "straight",
    label: "Bein lögn",
    description: "Hefðbundin lögn í beinum línum",
  },
  brick: {
    value: "brick",
    label: "Múrsteinslögn",
    description: "Hverri röð er tilfært um hálfa flís",
  },
  herringbone: {
    value: "herringbone",
    label: "Síldargrátslögn",
    description: "Flísar lagðar til skiptis í V-mynstur",
  },
  diagonal: {
    value: "diagonal",
    label: "Á ská (45°)",
    description: "Flísar snúnar 45° frá veggjum",
  },
  chevron: {
    value: "chevron",
    label: "Chevron",
    description: "V-formað mynstur, flísar skornar á horn",
  },
  stacked: {
    value: "stacked",
    label: "Upprétt lögn",
    description: "Beinar lóðréttar línur, engin tilfærsla",
  },
  "one-third": {
    value: "one-third",
    label: "Þriðjungslögn",
    description: "Tilfært um þriðjung flísar milli raða",
  },
};

/**
 * Allowed patterns per product category.
 * Based on real-world laying practices for each material type.
 * Key = lowercase category name from database.
 *
 * IMPORTANT DISTINCTION:
 * - Tiles (flísar): square/rectangular → grid patterns (straight, brick, diagonal, herringbone)
 * - Planks (parket): long/narrow → plank patterns (brick, stacked, one-third)
 * - Herringbone/chevron for planks ONLY if the product is specifically designed for it
 */
const CATEGORY_PATTERNS: Record<string, TilingPattern[]> = {
  // ═══════════════════════════════════════════
  // FLÍSAR (tiles) — square/rectangular shapes
  // ═══════════════════════════════════════════

  // Einlitar: solid color tiles, most flexible — all patterns work
  "einlitar flísar":           ["straight", "brick", "herringbone", "diagonal", "chevron", "stacked"],

  // Marmara: marble-look tiles (30x60 to 120x270)
  "marmaraútlit":              ["straight", "brick", "herringbone", "diagonal"],

  // Náttúrusteinn: natural stone look (various sizes)
  "náttúrusteinsútlit":        ["straight", "brick", "herringbone", "diagonal"],

  // Steypa: concrete look — simpler, modern patterns
  "steypuútlit":               ["straight", "brick", "diagonal"],

  // Terrazzo: terrazzo look
  "terrazzoútlit":             ["straight", "brick", "diagonal"],

  // Útiflísar: outdoor tiles — practical, simpler laying
  "útiflísar":                 ["straight", "brick", "diagonal"],

  // ═══════════════════════════════════════════
  // MYNSTURFLÍSAR — pattern is built into the tile
  // ═══════════════════════════════════════════
  "mynstur- og skrautflísar":  ["straight"],

  // ═══════════════════════════════════════════
  // VIÐARÚTLIT FLÍSAR — wood-look tiles (plank-shaped)
  // These tiles are designed to look like wood planks
  // Herringbone works because the tile shape supports it
  // ═══════════════════════════════════════════
  "viðarútlit flísar":         ["brick", "herringbone", "stacked", "one-third"],

  // ═══════════════════════════════════════════
  // PARKET — real wood / laminate planks
  // Standard plank laying: brick, stacked, one-third
  // Herringbone/chevron ONLY for specific products
  // ═══════════════════════════════════════════
  "viðarparket":               ["brick", "stacked", "one-third"],
  "harðparket":                ["brick", "stacked", "one-third"],

  // ═══════════════════════════════════════════
  // LVT / VINYL — click-together and glue-down
  // Planks: brick, stacked, one-third
  // Tiles: straight, brick
  // ═══════════════════════════════════════════
  "lauslimt parket":           ["brick", "stacked", "one-third"],
  "vínylflisar niðurlimdar":   ["straight", "brick", "diagonal"],
  "vínylflisar smelltar":      ["straight", "brick"],
  "vínylparket lauslagt":      ["brick", "stacked", "one-third"],
  "vínylparket niðurlimt":     ["brick", "stacked", "one-third"],
};

/**
 * Product-level pattern overrides.
 * Some products are specifically designed for a particular laying pattern.
 * These override the category-level defaults.
 * Matched against the product name (case-insensitive).
 */
const PRODUCT_PATTERN_OVERRIDES: Array<{
  namePattern: RegExp;
  patterns: TilingPattern[];
}> = [
  // Products named "HERRINGBONE" — specifically designed for herringbone laying
  // e.g., HERRINGBONE VERONA OAK SAND (Harðparket), ZENN HERRINGBONE (Lauslimt parket)
  { namePattern: /\bherringbone\b/i, patterns: ["herringbone"] },

  // Products named "CHEVRON" — specifically designed for chevron laying
  // e.g., LINKFLOOR CHEVRON BEIGE/BROWN/NATURAL (Lauslimt parket)
  { namePattern: /\bchevron\b/i, patterns: ["chevron"] },

  // SEGNO products — designed for herringbone/basket-weave (LEFT/RIGHT pieces)
  // e.g., SEGNO OAK BLONDE LEFT/RIGHT (Viðarparket)
  { namePattern: /\bsegno\b/i, patterns: ["herringbone"] },

  // Products with "basket weave" in description — herringbone family
  // e.g., GRACE OAK ERA (Basket weave), GRACE OAK CENTURY (Basket weave)
  { namePattern: /basket\s*weave/i, patterns: ["herringbone"] },

  // GENT 3D products — decorative pattern is printed on the large tile
  // These should only be laid straight since the pattern is built in
  // e.g., GENT ARROW 3D, GENT DIAMOND 3D, GENT LINE 3D, GENT STONE 3D
  { namePattern: /\bgent\b.*\b3d\b/i, patterns: ["straight"] },
];

/** Default pattern for unknown categories */
const DEFAULT_FALLBACK: TilingPattern[] = ["straight", "brick"];

/**
 * Get the allowed patterns for a given category and optional product name.
 * Product-level overrides take precedence over category-level patterns.
 */
export function getAllowedPatterns(categoryName: string, productName?: string, productDescription?: string): TilingPattern[] {
  // Check product-level overrides first
  if (productName || productDescription) {
    const searchText = `${productName || ""} ${productDescription || ""}`;
    for (const override of PRODUCT_PATTERN_OVERRIDES) {
      if (override.namePattern.test(searchText)) {
        return override.patterns;
      }
    }
  }

  // Fall back to category-level patterns
  const key = categoryName.toLowerCase().trim();
  return CATEGORY_PATTERNS[key] || DEFAULT_FALLBACK;
}

/**
 * Get a valid default pattern for a category/product.
 * Returns the first allowed pattern.
 */
export function getDefaultPattern(categoryName: string, productName?: string, productDescription?: string): TilingPattern {
  const allowed = getAllowedPatterns(categoryName, productName, productDescription);
  return allowed[0];
}

/**
 * Check if a pattern is valid for a category/product and return a valid one if not.
 */
export function ensureValidPattern(pattern: TilingPattern, categoryName: string, productName?: string, productDescription?: string): TilingPattern {
  const allowed = getAllowedPatterns(categoryName, productName, productDescription);
  if (allowed.includes(pattern)) return pattern;
  return allowed[0];
}

/** SVG pattern preview icons */
function PatternIcon({ pattern, isActive }: { pattern: TilingPattern; isActive: boolean }) {
  const stroke = isActive ? "white" : "currentColor";
  const fill = isActive ? "rgba(255,255,255,0.15)" : "rgba(148,163,184,0.1)";
  const w = 48;
  const h = 36;

  switch (pattern) {
    case "straight":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <rect x="1" y="1" width="22" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="25" y="1" width="22" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="1" y="19" width="22" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="25" y="19" width="22" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
        </svg>
      );

    case "brick":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <rect x="1" y="1" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="25" y="1" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="12" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="-10" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="34" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="1" y="25" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="25" y="25" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
        </svg>
      );

    case "herringbone":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <g stroke={stroke} strokeWidth="1.5">
            <rect x="6" y="2" width="8" height="18" rx="1" fill={fill} transform="rotate(0)" />
            <rect x="14" y="10" width="8" height="18" rx="1" fill={fill} transform="rotate(90 18 19)" />
            <rect x="24" y="2" width="8" height="18" rx="1" fill={fill} />
            <rect x="32" y="10" width="8" height="18" rx="1" fill={fill} transform="rotate(90 36 19)" />
          </g>
        </svg>
      );

    case "diagonal":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <g stroke={stroke} strokeWidth="1.5">
            <rect x="12" y="-4" width="16" height="16" rx="1" fill={fill} transform="rotate(45 20 4)" />
            <rect x="28" y="-4" width="16" height="16" rx="1" fill={fill} transform="rotate(45 36 4)" />
            <rect x="-4" y="-4" width="16" height="16" rx="1" fill={fill} transform="rotate(45 4 4)" />
            <rect x="4" y="12" width="16" height="16" rx="1" fill={fill} transform="rotate(45 12 20)" />
            <rect x="20" y="12" width="16" height="16" rx="1" fill={fill} transform="rotate(45 28 20)" />
            <rect x="36" y="12" width="16" height="16" rx="1" fill={fill} transform="rotate(45 44 20)" />
          </g>
        </svg>
      );

    case "chevron":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <g stroke={stroke} strokeWidth="1.5">
            <line x1="4" y1="18" x2="16" y2="4" />
            <line x1="16" y1="4" x2="28" y2="18" />
            <line x1="28" y1="18" x2="40" y2="4" />
            <line x1="4" y1="28" x2="16" y2="14" />
            <line x1="16" y1="14" x2="28" y2="28" />
            <line x1="28" y1="28" x2="40" y2="14" />
            <line x1="4" y1="36" x2="16" y2="24" />
            <line x1="16" y1="24" x2="28" y2="36" />
            <line x1="28" y1="36" x2="40" y2="24" />
          </g>
        </svg>
      );

    case "stacked":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <rect x="1" y="1" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="17" y="1" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="33" y="1" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="1" y="19" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="17" y="19" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="33" y="19" width="14" height="16" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
        </svg>
      );

    case "one-third":
      return (
        <svg width={w} height={h} viewBox="0 0 48 36" fill="none">
          <rect x="1" y="1" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="25" y="1" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="8" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="32" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="-14" y="13" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="15" y="25" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="-7" y="25" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
          <rect x="39" y="25" width="22" height="10" rx="1" stroke={stroke} strokeWidth="1.5" fill={fill} />
        </svg>
      );

    default:
      return null;
  }
}

interface TilingPatternSelectorProps {
  surfaceType: "floor" | "wall";
  selected: TilingPattern;
  onSelect: (pattern: TilingPattern) => void;
  /** Category name — used to filter which patterns are available */
  categoryName?: string;
  /** Product name — used for product-level pattern overrides */
  productName?: string;
  /** Product description — used for product-level pattern overrides (e.g., "Basket weave") */
  productDescription?: string;
}

export function TilingPatternSelector({ surfaceType, selected, onSelect, categoryName, productName, productDescription }: TilingPatternSelectorProps) {
  // Get allowed patterns for this category/product
  const allowedPatterns = categoryName
    ? getAllowedPatterns(categoryName, productName, productDescription)
    : Object.keys(PATTERN_INFO) as TilingPattern[];

  // Also filter by surface type for wall (some patterns don't apply to walls)
  const wallOnly: TilingPattern[] = ["straight", "brick", "herringbone", "stacked", "one-third"];
  const available = allowedPatterns
    .filter(p => surfaceType === "wall" ? wallOnly.includes(p) : true)
    .map(p => PATTERN_INFO[p]);

  // If only one pattern is available, don't show the selector at all
  if (available.length <= 1) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
        Leggingarmunstur
      </h4>
      <div className="grid grid-cols-2 min-[400px]:grid-cols-3 sm:grid-cols-4 gap-2">
        {available.map((pattern) => {
          const isActive = selected === pattern.value;
          return (
            <button
              key={pattern.value}
              onClick={() => onSelect(pattern.value)}
              className={`relative flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all overflow-hidden ${
                isActive
                  ? "text-white shadow-lg border-[var(--brand-primary)]"
                  : "border-slate-200 text-slate-500 hover:border-slate-300"
              }`}
              style={isActive ? { backgroundColor: "var(--brand-primary)", borderColor: "var(--brand-primary)" } : undefined}
              title={pattern.description}
            >
              {pattern.value === "straight" && (
                <span
                  className={`absolute top-0 right-0 text-[7px] font-bold uppercase tracking-wide px-3 py-[1px] ${
                    isActive ? "bg-emerald-400 text-white" : "bg-emerald-100 text-emerald-600"
                  }`}
                  style={{ transform: "rotate(0deg)", borderBottomLeftRadius: "6px" }}
                >
                  Algengast
                </span>
              )}
              <PatternIcon pattern={pattern.value} isActive={isActive} />
              <span className="text-[10px] font-medium leading-tight text-center">
                {pattern.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
