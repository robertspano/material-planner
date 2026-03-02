"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";

interface Product {
  id: string;
  name: string;
  price: number | null;
  unit: string;
  discountPercent?: number | null;
  tileWidth?: number | null;
  tileHeight?: number | null;
}

interface MaterialEstimateProps {
  product: Product;
  surfaceType: "floor" | "wall";
  companySlug: string;
  roomImageUrl?: string;
  generationId?: string | null;
  resultImageUrl?: string;
  company?: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  } | null;
  /** Called whenever estimate data changes (area, price, etc.) */
  onEstimateChange?: (data: { area: number; totalNeeded: number; unitPrice: number | null; totalPrice: number | null }) => void;
  /** If true, hides the quote download buttons (used when shown in a compact list) */
  compact?: boolean;
}

interface MeasureResult {
  floorArea: number;
  wallArea: number;
  roomWidth: number;
  roomLength: number;
  roomHeight: number;
  roomType?: string | null;
  confidence?: number;
  notes?: string;
  cached?: boolean;
  noApi?: boolean;
  source?: "wizart" | "gemini" | "cache";
}

const WASTE_FACTOR = 0.10;

function formatUnit(unit: string): string {
  const map: Record<string, string> = { m2: "m\u00B2", m3: "m\u00B3", stk: "stk" };
  return map[unit] || unit;
}

function formatPrice(n: number): string {
  return n.toLocaleString("is-IS");
}

export function MaterialEstimate({
  product,
  surfaceType,
  companySlug,
  roomImageUrl,
  generationId,
  resultImageUrl,
  onEstimateChange,
  compact,
}: MaterialEstimateProps) {
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [area, setArea] = useState<string>("");
  const [dim1, setDim1] = useState<string>(""); // floor: width, wall: wall length (perimeter)
  const [dim2, setDim2] = useState<string>(""); // floor: length, wall: height

  // Auto-measure
  const autoMeasure = useCallback(async () => {
    if (!roomImageUrl || measuring || measured) return;
    setMeasuring(true);
    try {
      const res = await fetch(`/api/planner/measure?company=${companySlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomImageUrl,
          generationId,
          resultImageUrl,
          tileWidth: product.tileWidth,
          tileHeight: product.tileHeight,
          surfaceType,
        }),
      });
      const data: MeasureResult = await res.json();
      if (data.noApi || !res.ok) {
        setMeasured(false);
        return;
      }
      if (surfaceType === "floor") {
        setArea(data.floorArea?.toFixed(1) || "");
        setDim1(data.roomWidth?.toFixed(1) || "");
        setDim2(data.roomLength?.toFixed(1) || "");
      } else {
        // Wall: wallArea is total wall area (all walls)
        // Compute wall length = wallArea / height so dim1 \u00D7 dim2 = wallArea
        const wallArea = data.wallArea || 0;
        const height = data.roomHeight || 2.5;
        const wallLength = height > 0 ? wallArea / height : 0;
        setArea(wallArea.toFixed(1));
        setDim1(wallLength.toFixed(1));
        setDim2(height.toFixed(1));
      }
      setMeasured(true);
    } catch {
      setMeasured(false);
    } finally {
      setMeasuring(false);
    }
  }, [roomImageUrl, generationId, companySlug, surfaceType, measuring, measured, resultImageUrl, product.tileWidth, product.tileHeight]);

  useEffect(() => { autoMeasure(); }, [autoMeasure]);

  const areaNum = parseFloat(area) || 0;
  const totalNeeded = areaNum * (1 + WASTE_FACTOR);
  const unitPrice = product.discountPercent && product.price
    ? Math.round(product.price * (1 - product.discountPercent / 100))
    : product.price;
  const totalPrice = unitPrice ? totalNeeded * unitPrice : null;
  const unit = formatUnit(product.unit || "m\u00B2");

  // Report estimate data changes to parent
  useEffect(() => {
    onEstimateChange?.({ area: areaNum, totalNeeded, unitPrice: unitPrice ?? null, totalPrice: totalPrice ?? null });
  }, [areaNum, totalNeeded, unitPrice, totalPrice, onEstimateChange]);

  const handleDimensionChange = (d1: string, d2: string) => {
    setDim1(d1);
    setDim2(d2);
    const v1 = parseFloat(d1) || 0;
    const v2 = parseFloat(d2) || 0;
    if (v1 > 0 && v2 > 0) setArea((v1 * v2).toFixed(1));
  };

  const surfaceLabel = surfaceType === "floor" ? "G\u00F3lffl\u00F6tur" : "Veggfl\u00F6tur";
  const dim1Label = surfaceType === "floor" ? "Breidd (m)" : "Vegglengd (m)";
  const dim2Label = surfaceType === "floor" ? "Lengd (m)" : "H\u00E6\u00F0 (m)";

  return (
    <div className={compact ? "bg-white overflow-hidden" : "bg-white rounded-2xl border border-slate-200 overflow-hidden"}>
      {/* Header */}
      <div className={`px-4 py-3 ${compact ? "border-t border-slate-100" : "border-b border-slate-100"} flex items-center justify-between`}>
        <h3 className="text-sm font-semibold text-slate-800">
          {surfaceLabel}
        </h3>
        {measuring ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            M\u00E6li\u2026
          </div>
        ) : measured ? (
          <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
            \u00C1\u00E6tlun \u2014 breyttu ef \u00FEarf
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Dimensions \u2014 always visible, editable inline */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-[10px] text-slate-400 uppercase tracking-wider">{dim1Label}</label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="\u2014"
              value={dim1}
              onChange={(e) => handleDimensionChange(e.target.value, dim2)}
              className="w-full text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>
          <div className="flex items-end pb-1 text-slate-300">\u00D7</div>
          <div className="flex-1">
            <label className="text-[10px] text-slate-400 uppercase tracking-wider">
              {dim2Label}
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="\u2014"
              value={dim2}
              onChange={(e) => handleDimensionChange(dim1, e.target.value)}
              className="w-full text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>
          <div className="flex items-end pb-1 text-slate-300">=</div>
          <div className="flex-1">
            <label className="text-[10px] text-slate-400 uppercase tracking-wider">{surfaceLabel}</label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="\u2014"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="w-full text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 mt-0.5 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30"
            />
          </div>
          <div className="flex items-end pb-1.5 text-sm text-slate-500">{unit}</div>
        </div>

        {/* Calculation summary \u2014 only when area is set */}
        {areaNum > 0 && (
          <>
            <div className="h-px bg-slate-100" />

            {/* Waste */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">S\u00F3un (10%)</span>
              <span className="text-slate-600">+{(areaNum * WASTE_FACTOR).toFixed(1)} {unit}</span>
            </div>

            {/* Total needed */}
            <div className="flex items-center justify-between text-sm font-semibold">
              <span className="text-slate-800">Efni sem \u00FEarf</span>
              <span style={{ color: "var(--brand-primary)" }}>{totalNeeded.toFixed(1)} {unit}</span>
            </div>

            {/* Price per unit */}
            {unitPrice && unitPrice > 0 && (
              <>
                <div className="h-px bg-slate-100" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Ver\u00F0 per {unit}</span>
                  <div className="text-right">
                    {product.discountPercent && product.price ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 line-through text-xs">{formatPrice(product.price)} kr</span>
                        <span className="text-emerald-600 font-medium">{formatPrice(unitPrice)} kr</span>
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 rounded">-{product.discountPercent}%</span>
                      </div>
                    ) : (
                      <span className="text-slate-700">{formatPrice(unitPrice)} kr</span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* No price message */}
            {(!unitPrice || unitPrice === 0) && (
              <p className="text-xs text-slate-400 text-center italic">
                Ver\u00F0 ekki skr\u00E1\u00F0
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
