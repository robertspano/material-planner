"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, ImageIcon, Check, ChevronDown } from "lucide-react";

function formatUnit(unit: string): string {
  const map: Record<string, string> = { m2: "m²", m3: "m³", stk: "stk" };
  return map[unit] || unit;
}

function formatPrice(price: number): string {
  return price.toLocaleString("is-IS");
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
  sizeLabel: string | null;
  category: { name: string };
  variants: Product[];
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

// ---------- Size Dropdown ----------
function SizeDropdown({
  product,
  selectedProductId,
  activeVariant,
  onSelect,
}: {
  product: Product;
  selectedProductId: string | null;
  activeVariant: Product | null | undefined;
  onSelect: (p: Product) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const allSizes = [
    { id: product.id, label: product.sizeLabel || (product.tileWidth && product.tileHeight ? `${product.tileWidth}×${product.tileHeight}` : ""), isParent: true },
    ...product.variants.map(v => ({
      id: v.id,
      label: v.sizeLabel || (v.tileWidth && v.tileHeight ? `${v.tileWidth}×${v.tileHeight}` : ""),
      isParent: false,
      variant: v,
    })),
  ].filter(s => s.label);

  const selectedLabel = activeVariant
    ? (activeVariant.sizeLabel || (activeVariant.tileWidth && activeVariant.tileHeight ? `${activeVariant.tileWidth}×${activeVariant.tileHeight}` : ""))
    : allSizes[0]?.label || "";

  if (allSizes.length === 0) return null;

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex items-center gap-1 w-full text-left text-[10px] px-1.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 transition-colors"
      >
        <span className="font-medium text-slate-600 truncate">{selectedLabel} cm</span>
        {allSizes.length > 1 && (
          <span className="ml-auto flex items-center gap-0.5 text-slate-400 flex-shrink-0">
            <span className="text-[9px]">+{allSizes.length - 1}</span>
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        )}
      </button>

      {open && allSizes.length > 1 && (
        <div className="absolute left-0 right-0 bottom-full mb-1 z-50 bg-white rounded-lg shadow-xl border border-slate-200 py-1 max-h-40 overflow-y-auto">
          {allSizes.map((s) => {
            const isSel = selectedProductId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if ("variant" in s && s.variant) {
                    onSelect({ ...s.variant, category: product.category, variants: [] } as Product);
                  } else {
                    onSelect(product);
                  }
                  setOpen(false);
                }}
                className={`w-full text-left px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  isSel
                    ? "bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s.label} cm
                {isSel && <Check className="w-3 h-3 inline ml-1.5 -mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
            const hasVariants = product.variants && product.variants.length > 0;
            const isSelected = selectedProductId === product.id ||
              (hasVariants && product.variants.some(v => v.id === selectedProductId));
            const activeVariant = hasVariants ? product.variants.find(v => v.id === selectedProductId) : null;
            const activePrice = activeVariant?.price ?? product.price;
            const activeTileW = activeVariant?.tileWidth ?? product.tileWidth;
            const activeTileH = activeVariant?.tileHeight ?? product.tileHeight;
            const activeDiscount = activeVariant?.discountPercent ?? product.discountPercent;
            const activeUnit = activeVariant?.unit ?? product.unit;
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
                {/* Hover popup — room/installation photo */}
                {product.imageUrl && product.imageUrl !== "/placeholder-product.jpg" && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 origin-bottom hidden group-hover:block">
                    <div className="w-96 rounded-2xl overflow-hidden shadow-2xl border-2 border-white bg-white ring-1 ring-black/5">
                      <img
                        src={product.imageUrl}
                        alt={`${product.name} - uppsetning`}
                        className="w-full aspect-[4/3] object-cover rounded-t-xl"
                      />
                      <div className="px-3 py-2.5">
                        <p className="text-sm font-semibold text-slate-900 leading-tight">{product.name}</p>
                        {product.description && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{product.description}</p>
                        )}
                        {activeTileW && activeTileH && (
                          <p className="text-xs text-slate-400 font-medium mt-0.5">
                            {activeTileW}×{activeTileH} cm
                          </p>
                        )}
                        {activePrice ? (
                          <div className="flex items-center gap-1.5 mt-1">
                            {activeDiscount ? (
                              <>
                                <span className="text-xs text-slate-400 line-through">
                                  {formatPrice(activePrice)} kr/{formatUnit(activeUnit)}
                                </span>
                                <span className="text-xs font-bold text-emerald-600">
                                  {formatPrice(Math.round(activePrice * (1 - activeDiscount / 100)))} kr/{formatUnit(activeUnit)}
                                </span>
                                <span className="text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full">
                                  -{activeDiscount}%
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-slate-500">
                                {formatPrice(activePrice)} kr/{formatUnit(activeUnit)}
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
                  {(product.swatchUrl || product.imageUrl) && product.imageUrl !== "/placeholder-product.jpg" ? (
                    <img src={product.swatchUrl || product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
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
                  {activeDiscount && (
                    <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white bg-emerald-500 px-1.5 py-0.5 rounded-full shadow-sm">
                      -{activeDiscount}%
                    </span>
                  )}
                </div>
                <div className="px-2 py-1.5">
                  <p className="text-xs font-semibold text-slate-900 truncate">{product.name}</p>
                  {!hasVariants && activeTileW && activeTileH && (
                    <p className="text-[11px] text-slate-500">{activeTileW}×{activeTileH} cm</p>
                  )}
                  {activePrice && (
                    <p className="text-[11px] font-bold text-slate-800 mt-0.5">
                      {activeDiscount ? (
                        <>
                          <span className="line-through text-slate-400 font-normal">{formatPrice(activePrice)}</span>
                          {" "}
                          <span className="text-emerald-600">{formatPrice(Math.round(activePrice * (1 - activeDiscount / 100)))} kr/{formatUnit(activeUnit)}</span>
                        </>
                      ) : (
                        <>{formatPrice(activePrice)} kr/{formatUnit(activeUnit)}</>
                      )}
                    </p>
                  )}
                  {hasVariants && (
                    <SizeDropdown
                      product={product}
                      selectedProductId={selectedProductId}
                      activeVariant={activeVariant}
                      onSelect={onSelect}
                    />
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
