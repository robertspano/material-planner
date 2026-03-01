"use client";

import { useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, ImageIcon, Check } from "lucide-react";

function formatUnit(unit: string): string {
  const map: Record<string, string> = { m2: "m²", m3: "m³", stk: "stk" };
  return map[unit] || unit;
}

function formatPrice(price: number): string {
  return price.toLocaleString("is-IS");
}

/* Tile layout preview — shows tiles with grout lines like a real floor/wall */
function TilePreview({ imageUrl, tileWidth, tileHeight }: { imageUrl: string; tileWidth: number | null; tileHeight: number | null }) {
  // Calculate tile aspect ratio and grid
  const tw = tileWidth || 30;
  const th = tileHeight || 30;
  const ratio = tw / th; // >1 = wide tile, <1 = tall tile

  // How many tiles fit — aim for ~4-6 columns
  const cols = ratio >= 2 ? 3 : ratio >= 1 ? 4 : 5;
  const tilePxW = Math.floor(240 / cols); // popup is w-64 = 256px, minus grout
  const tilePxH = Math.round(tilePxW / ratio);
  const rows = Math.max(2, Math.min(5, Math.ceil(180 / tilePxH)));

  return (
    <div
      className="w-full rounded-t-xl overflow-hidden"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, ${tilePxH}px)`,
        gap: "2px",
        padding: "2px",
        backgroundColor: "#d4d0c8",
      }}
    >
      {Array.from({ length: cols * rows }).map((_, i) => (
        <div key={i} className="overflow-hidden">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
}

interface Category {
  id: string;
  name: string;
  surfaceType: string;
  _count?: { products: number };
}

interface Product {
  id: string;
  name: string;
  imageUrl: string;
  swatchUrl: string | null;
  price: number | null;
  unit: string;
  description: string | null;
  tileWidth: number | null;
  tileHeight: number | null;
  discountPercent: number | null;
  category: { name: string };
}

interface ProductCarouselProps {
  companySlug: string;
  surfaceType: "floor" | "wall";
  selectedProductId: string | null;
  onSelect: (product: Product) => void;
}

// Group definitions
interface CategoryGroup {
  key: string;
  label: string;
  categories: Category[];
  totalProducts: number;
}

function groupCategories(cats: Category[]): CategoryGroup[] {
  const parketNames = ["harðparket", "viðarparket", "lauslimt parket"];
  const vínylNames = ["víny"];

  const groups: CategoryGroup[] = [
    { key: "flisar", label: "Flísar", categories: [], totalProducts: 0 },
    { key: "parket", label: "Parket", categories: [], totalProducts: 0 },
    { key: "vinyl", label: "Vínil", categories: [], totalProducts: 0 },
  ];

  for (const cat of cats) {
    const lowerName = cat.name.toLowerCase();
    const count = cat._count?.products || 0;
    if (parketNames.some(n => lowerName.includes(n))) {
      groups[1].categories.push(cat);
      groups[1].totalProducts += count;
    } else if (vínylNames.some(n => lowerName.includes(n))) {
      groups[2].categories.push(cat);
      groups[2].totalProducts += count;
    } else {
      groups[0].categories.push(cat);
      groups[0].totalProducts += count;
    }
  }

  return groups.filter(g => g.categories.length > 0);
}

export function ProductCarousel({ companySlug, surfaceType, selectedProductId, onSelect }: ProductCarouselProps) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);

  const { data: categories = [], isLoading: catsLoading } = useQuery<Category[]>({
    queryKey: [`/api/planner/categories?company=${companySlug}`],
  });

  // Filter categories by surface type
  const filteredCats = categories.filter(
    (c) => c.surfaceType === surfaceType || c.surfaceType === "both"
  );

  // Group them
  const groups = useMemo(() => groupCategories(filteredCats), [filteredCats]);

  // Figure out which group the active category belongs to
  const resolvedGroupKey = useMemo(() => {
    if (activeGroupKey) return activeGroupKey;
    if (activeCategoryId) {
      const g = groups.find(g => g.categories.some(c => c.id === activeCategoryId));
      if (g) return g.key;
    }
    return groups[0]?.key || null;
  }, [activeGroupKey, activeCategoryId, groups]);

  const currentGroup = groups.find(g => g.key === resolvedGroupKey) || groups[0];

  // If no category selected yet, default to first in current group
  const selectedCatId = activeCategoryId
    || currentGroup?.categories[0]?.id
    || filteredCats[0]?.id
    || "";

  const selectedCat = filteredCats.find(c => c.id === selectedCatId);

  const { data: products = [], isLoading: prodsLoading, isPlaceholderData } = useQuery<Product[]>({
    queryKey: [`/api/planner/products?company=${companySlug}&categoryId=${selectedCatId}`],
    enabled: !!selectedCatId,
    placeholderData: keepPreviousData,
  });

  if (catsLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>;
  }

  if (filteredCats.length === 0) {
    return (
      <div className="text-center p-8 text-slate-500">
        Engin {surfaceType === "floor" ? "gólfefni" : "veggjaefni"} í boði
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Main group tabs ── always visible */}
      <div className="flex gap-2">
        {groups.map((group) => {
          const isActive = resolvedGroupKey === group.key;
          return (
            <button
              key={group.key}
              onClick={() => {
                setActiveGroupKey(group.key);
                // Select first category in this group
                setActiveCategoryId(group.categories[0]?.id || null);
              }}
              className={`relative flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold transition-all ${
                isActive
                  ? "text-white shadow-md"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
              }`}
              style={isActive ? { backgroundColor: "var(--brand-primary)" } : undefined}
            >
              <span>{group.label}</span>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400"
              }`}>
                {group.totalProducts}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Sub-categories ── always visible for active group */}
      {currentGroup && currentGroup.categories.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {currentGroup.categories.map((cat) => {
            const isActive = selectedCatId === cat.id;
            const count = cat._count?.products || 0;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategoryId(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)] ring-1 ring-[var(--brand-primary)]/25 font-semibold"
                    : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                }`}
              >
                {cat.name}
                <span className={`text-[10px] ${isActive ? "text-[var(--brand-primary)]/60" : "text-slate-400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Product Grid ── */}
      {prodsLoading && products.length === 0 ? (
        <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
      ) : products.length === 0 ? (
        <div className="text-center p-8 text-slate-500">
          Engar vörur í þessum flokki
        </div>
      ) : (
        <div className={`relative grid grid-cols-2 min-[400px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 lg:gap-3 overflow-visible transition-opacity duration-150 ${isPlaceholderData ? "opacity-50 pointer-events-none" : ""}`}>
          {products.map((product) => {
            const isSelected = selectedProductId === product.id;
            return (
              <button
                key={product.id}
                onClick={() => onSelect(product)}
                className={`group relative rounded-xl border-2 transition-all text-left overflow-visible ${
                  isSelected
                    ? "border-[var(--brand-primary)] shadow-lg ring-2 ring-[var(--brand-primary)]/30"
                    : "border-slate-200 hover:border-slate-400"
                }`}
              >
                {/* Hover popup — tile layout preview with grout lines */}
                {product.imageUrl && product.imageUrl !== "/placeholder-product.jpg" && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-bottom hidden group-hover:block">
                    <div className="w-64 rounded-2xl overflow-hidden shadow-2xl border-2 border-white bg-white ring-1 ring-black/5">
                      <TilePreview imageUrl={product.imageUrl} tileWidth={product.tileWidth} tileHeight={product.tileHeight} />
                      <div className="px-3 py-2.5">
                        <p className="text-sm font-semibold text-slate-900 leading-tight">{product.name}</p>
                        {product.tileWidth && product.tileHeight && (
                          <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {product.tileWidth}×{product.tileHeight} cm
                          </p>
                        )}
                        {product.price ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            {product.discountPercent ? (
                              <>
                                <span className="text-xs text-slate-400 line-through">
                                  {formatPrice(product.price)} kr/{formatUnit(product.unit)}
                                </span>
                                <span className="text-xs font-bold text-emerald-600">
                                  {formatPrice(Math.round(product.price * (1 - product.discountPercent / 100)))} kr/{formatUnit(product.unit)}
                                </span>
                                <span className="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full">
                                  -{product.discountPercent}%
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-slate-500">
                                {formatPrice(product.price)} kr/{formatUnit(product.unit)}
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-white rotate-45 border-r border-b border-black/5" />
                  </div>
                )}
                <div className="aspect-square bg-slate-100 relative rounded-t-[10px] overflow-hidden">
                  {product.imageUrl && product.imageUrl !== "/placeholder-product.jpg" ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-slate-300" />
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute inset-0 bg-[var(--brand-primary)]/20 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-[var(--brand-primary)] flex items-center justify-center">
                        <Check className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  )}
                  {product.discountPercent && (
                    <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full shadow-sm">
                      -{product.discountPercent}%
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <p className="text-xs font-semibold text-slate-900 truncate">{product.name}</p>
                  {product.tileWidth && product.tileHeight && (
                    <p className="text-[11px] text-slate-500">{product.tileWidth}×{product.tileHeight} cm</p>
                  )}
                  {product.price && (
                    <p className="text-[11px] font-bold text-slate-800 mt-0.5">
                      {product.discountPercent ? (
                        <>
                          <span className="line-through text-slate-400 font-normal">{formatPrice(product.price)}</span>
                          {" "}
                          <span className="text-emerald-600">{formatPrice(Math.round(product.price * (1 - product.discountPercent / 100)))} kr/{formatUnit(product.unit)}</span>
                        </>
                      ) : (
                        <>{formatPrice(product.price)} kr/{formatUnit(product.unit)}</>
                      )}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
