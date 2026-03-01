"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Calendar, ImageIcon, Ruler, Package,
  Loader2, ChevronDown, X, ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { useAdminCompany } from "@/components/admin/admin-company-context";

interface QuoteGeneration {
  id: string;
  sessionId: string;
  batchId: string | null;
  roomImageUrl: string;
  roomWidth: number | null;
  roomLength: number | null;
  roomHeight: number | null;
  floorArea: number | null;
  wallArea: number | null;
  createdAt: string;
  products: {
    id: string;
    surfaceType: string;
    product: {
      id: string;
      name: string;
      price: number | null;
      unit: string;
      imageUrl: string;
      discountPercent: number | null;
      tileWidth: number | null;
      tileHeight: number | null;
    };
  }[];
  results: {
    imageUrl: string;
    surfaceType: string;
  }[];
}

// Group generations by date
function groupByDate(generations: QuoteGeneration[]) {
  const groups = new Map<string, QuoteGeneration[]>();

  for (const gen of generations) {
    const d = new Date(gen.createdAt);
    const key = d.toISOString().split("T")[0]; // YYYY-MM-DD
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(gen);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }));
}

function formatDateHeading(iso: string) {
  const d = new Date(iso + "T12:00:00");
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = d.toDateString() === today.toDateString();
  const isYesterday = d.toDateString() === yesterday.toDateString();

  if (isToday) return "Í dag";
  if (isYesterday) return "Í gær";

  return d.toLocaleDateString("is-IS", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("is-IS", { hour: "2-digit", minute: "2-digit" });
}

export default function TilbodPage() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const quotesUrl = adminApiUrl("/api/admin/quotes");

  const { data: generations = [], isLoading } = useQuery<QuoteGeneration[]>({
    queryKey: [quotesUrl],
  });

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const grouped = groupByDate(generations);
  const totalCount = generations.length;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin?company=${companySlug}`}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 transition-colors text-slate-400"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tilboð</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalCount > 0 ? `${totalCount} tilboð samtals` : "Engin tilboð enn"}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="flex gap-4">
                <div className="w-16 h-16 bg-slate-100 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-1/2" />
                  <div className="h-3 bg-slate-100 rounded w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <FileText className="w-14 h-14 text-slate-200 mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-500">Engin tilboð fundust</p>
          <p className="text-xs text-slate-400 mt-1">Tilboð birtast hér þegar viðskiptavinir nota Planner</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ date, items }) => (
            <div key={date}>
              {/* Date heading */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-300" />
                  <h2 className="text-sm font-bold text-slate-700">{formatDateHeading(date)}</h2>
                </div>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400 tabular-nums">{items.length} tilboð</span>
              </div>

              {/* Quotes for this date */}
              <div className="space-y-2">
                {items.map((gen) => {
                  const isExpanded = expandedId === gen.id;
                  const productNames = gen.products.map(p => p.product.name);
                  const hasArea = gen.floorArea || gen.wallArea;

                  return (
                    <div
                      key={gen.id}
                      className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-all"
                    >
                      {/* Row — clickable */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : gen.id)}
                        className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        {/* Thumbnail */}
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0">
                          {gen.results[0]?.imageUrl ? (
                            <img
                              src={gen.results[0].imageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : gen.roomImageUrl ? (
                            <img
                              src={gen.roomImageUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <ImageIcon className="w-5 h-5 text-slate-300" />
                            </div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {productNames.length > 0
                              ? productNames.join(", ")
                              : "Óþekkt vara"}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                            <span>{formatTime(gen.createdAt)}</span>
                            {hasArea && (
                              <span className="flex items-center gap-0.5">
                                <Ruler className="w-3 h-3" />
                                {gen.floorArea ? `${gen.floorArea.toFixed(1)} m²` : `${gen.wallArea?.toFixed(1)} m² veggur`}
                              </span>
                            )}
                            {gen.results.length > 0 && (
                              <span className="flex items-center gap-0.5">
                                <ImageIcon className="w-3 h-3" />
                                {gen.results.length} {gen.results.length === 1 ? "mynd" : "myndir"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Product count badge */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            {gen.products.length} {gen.products.length === 1 ? "vara" : "vörur"}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </div>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 p-4 space-y-4">
                          {/* Room info */}
                          {(gen.roomWidth || gen.roomLength) && (
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span className="font-medium text-slate-400 uppercase tracking-wider text-[10px]">Herbergi</span>
                              {gen.roomWidth && gen.roomLength && (
                                <span>{gen.roomWidth.toFixed(1)} × {gen.roomLength.toFixed(1)} m</span>
                              )}
                              {gen.roomHeight && (
                                <span>Hæð: {gen.roomHeight.toFixed(1)} m</span>
                              )}
                              {gen.floorArea && (
                                <span>Gólfflötur: {gen.floorArea.toFixed(1)} m²</span>
                              )}
                              {gen.wallArea && (
                                <span>Veggflötur: {gen.wallArea.toFixed(1)} m²</span>
                              )}
                            </div>
                          )}

                          {/* Products detail */}
                          <div>
                            <p className="font-medium text-slate-400 uppercase tracking-wider text-[10px] mb-2">Vörur</p>
                            <div className="space-y-2">
                              {gen.products.map((gp) => (
                                <div key={gp.id} className="flex items-center gap-3 bg-slate-50 rounded-lg p-2.5">
                                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                                    {gp.product.imageUrl && gp.product.imageUrl !== "/placeholder-product.jpg" ? (
                                      <img src={gp.product.imageUrl} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Package className="w-4 h-4 text-slate-300" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 truncate">{gp.product.name}</p>
                                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                                      <span className="capitalize">{gp.surfaceType === "floor" ? "Gólf" : "Veggur"}</span>
                                      {gp.product.price && (
                                        <span>
                                          {gp.product.discountPercent
                                            ? Math.round(gp.product.price * (1 - gp.product.discountPercent / 100)).toLocaleString("is-IS")
                                            : gp.product.price.toLocaleString("is-IS")} kr/{gp.product.unit === "m2" ? "m²" : "stk"}
                                        </span>
                                      )}
                                      {(gp.product.tileWidth && gp.product.tileHeight) && (
                                        <span>{gp.product.tileWidth}×{gp.product.tileHeight} cm</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Result images */}
                          {gen.results.length > 0 && (
                            <div>
                              <p className="font-medium text-slate-400 uppercase tracking-wider text-[10px] mb-2">Niðurstöður</p>
                              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                {gen.results.map((r, i) => (
                                  <button
                                    key={i}
                                    onClick={() => setSelectedImage(r.imageUrl)}
                                    className="aspect-square rounded-lg overflow-hidden bg-slate-100 hover:opacity-80 transition-opacity"
                                  >
                                    <img src={r.imageUrl} alt="" className="w-full h-full object-cover" />
                                  </button>
                                ))}
                                {/* Room image */}
                                {gen.roomImageUrl && (
                                  <button
                                    onClick={() => setSelectedImage(gen.roomImageUrl)}
                                    className="aspect-square rounded-lg overflow-hidden bg-slate-100 hover:opacity-80 transition-opacity relative"
                                  >
                                    <img src={gen.roomImageUrl} alt="" className="w-full h-full object-cover" />
                                    <span className="absolute bottom-1 left-1 text-[9px] bg-black/50 text-white px-1.5 py-0.5 rounded">
                                      Upprunalegt
                                    </span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Image lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt=""
            className="max-w-full max-h-full rounded-xl shadow-2xl"
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}
