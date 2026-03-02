"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Calendar, Download, ExternalLink,
  Loader2, ChevronDown, ArrowLeft, Package,
} from "lucide-react";
import Link from "next/link";
import { useAdminCompany } from "@/components/admin/admin-company-context";

interface QuoteItemData {
  productName: string;
  surfaceType: "floor" | "wall" | "both";
  area: number;
  totalNeeded: number;
  unitPrice: number | null;
  totalPrice: number;
  unit: string;
  discountPercent?: number | null;
  price?: number | null;
}

interface QuoteRecord {
  id: string;
  pdfUrl: string;
  items: QuoteItemData[];
  combinedTotal: number | null;
  roomImageUrl: string | null;
  resultImageUrls: string[];
  productNames: string[];
  createdAt: string;
}

// Group quotes by date
function groupByDate(quotes: QuoteRecord[]) {
  const groups = new Map<string, QuoteRecord[]>();

  for (const q of quotes) {
    const d = new Date(q.createdAt);
    const key = d.toISOString().split("T")[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(q);
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

  if (isToday) return "I dag";
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

function formatPrice(n: number): string {
  return n.toLocaleString("is-IS");
}

function formatUnit(unit: string): string {
  const map: Record<string, string> = { m2: "m²", m3: "m³", stk: "stk" };
  return map[unit] || unit;
}

export default function TilbodPage() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const quotesUrl = adminApiUrl("/api/admin/quotes");

  const { data: quotes = [], isLoading } = useQuery<QuoteRecord[]>({
    queryKey: [quotesUrl],
  });

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const grouped = groupByDate(quotes);
  const totalCount = quotes.length;

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
                <div className="w-12 h-12 bg-slate-100 rounded-lg flex-shrink-0" />
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
          <p className="text-xs text-slate-400 mt-1">
            Tilboð birtast hér þegar viðskiptavinir ýta á &ldquo;Sækja tilboð&rdquo;
          </p>
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
                {items.map((quote) => {
                  const isExpanded = expandedId === quote.id;
                  const itemsData = Array.isArray(quote.items) ? quote.items as QuoteItemData[] : [];

                  return (
                    <div
                      key={quote.id}
                      className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-all"
                    >
                      {/* Row -- clickable */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : quote.id)}
                        className="w-full flex items-center gap-4 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        {/* PDF icon */}
                        <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-6 h-6 text-red-500" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {quote.productNames.length > 0
                              ? quote.productNames.join(", ")
                              : "Óþekkt vara"}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                            <span>{formatTime(quote.createdAt)}</span>
                            {quote.combinedTotal && quote.combinedTotal > 0 && (
                              <span className="font-medium text-slate-600">
                                {formatPrice(Math.round(quote.combinedTotal))} kr
                              </span>
                            )}
                            <span className="flex items-center gap-0.5">
                              <Package className="w-3 h-3" />
                              {itemsData.length} {itemsData.length === 1 ? "vara" : "vörur"}
                            </span>
                          </div>
                        </div>

                        {/* Actions + expand */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a
                            href={quote.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                            title="Opna PDF"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                          </a>
                          <a
                            href={quote.pdfUrl}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                            title="Sækja PDF"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-500" />
                          </a>
                          <ChevronDown
                            className={`w-4 h-4 text-slate-300 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </div>
                      </button>

                      {/* Expanded detail — shows quote breakdown */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 p-4 space-y-4">
                          {/* PDF embed/preview */}
                          <div className="rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
                            <iframe
                              src={`${quote.pdfUrl}#toolbar=0`}
                              className="w-full h-[500px]"
                              title="Tilboð PDF"
                            />
                          </div>

                          {/* Items breakdown */}
                          <div>
                            <p className="font-medium text-slate-400 uppercase tracking-wider text-[10px] mb-2">Sundurliðun</p>
                            <div className="space-y-2">
                              {itemsData.map((item, idx) => {
                                const unit = formatUnit(item.unit || "m2");
                                const surfLabel = item.surfaceType === "floor" ? "Gólf" : item.surfaceType === "both" ? "Gólf og veggir" : "Veggir";
                                return (
                                  <div key={idx} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <span className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded bg-slate-400 flex-shrink-0">
                                        {surfLabel}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-900 truncate">{item.productName}</p>
                                        <p className="text-xs text-slate-400">
                                          {item.area > 0 ? `${item.area.toFixed(1)} ${unit}` : "—"}
                                          {item.unitPrice ? ` × ${formatPrice(item.unitPrice)} kr/${unit}` : ""}
                                        </p>
                                      </div>
                                    </div>
                                    {item.totalPrice > 0 && (
                                      <span className="text-sm font-bold text-slate-700 flex-shrink-0 ml-3">
                                        {formatPrice(Math.round(item.totalPrice))} kr
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Combined total */}
                          {quote.combinedTotal && quote.combinedTotal > 0 && (
                            <div className="flex items-center justify-between bg-slate-900 rounded-lg p-4">
                              <span className="text-sm font-bold text-white">
                                {itemsData.length > 1 ? "Samtals" : "Áætlaður kostnaður"}
                              </span>
                              <span className="text-lg font-bold text-white">
                                {formatPrice(Math.round(quote.combinedTotal))} kr
                              </span>
                            </div>
                          )}

                          {/* Download button */}
                          <div className="flex gap-2">
                            <a
                              href={quote.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Opna PDF
                            </a>
                            <a
                              href={quote.pdfUrl}
                              download
                              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <Download className="w-4 h-4" />
                              Sækja PDF
                            </a>
                          </div>
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
    </div>
  );
}
