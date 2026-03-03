"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Calendar, ExternalLink,
  ChevronDown, ArrowLeft, Package, Search,
  Loader2, Mail,
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
  customerEmail: string | null;
  roomImageUrl: string | null;
  resultImageUrls: string[];
  productNames: string[];
  createdAt: string;
}

const PERIODS = [
  { value: "week", label: "Vika" },
  { value: "month", label: "Mánuður" },
  { value: "3months", label: "3 mánuðir" },
  { value: "all", label: "Allt" },
] as const;

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
  if (isYesterday) return "I gær";

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

  const [period, setPeriod] = useState<string>("month");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Debounce search
  const searchTimeout = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (searchTimeout[0]) clearTimeout(searchTimeout[0]);
    searchTimeout[1](setTimeout(() => setDebouncedSearch(val), 300));
  };

  const quotesUrl = `${adminApiUrl("/api/admin/quotes")}${period !== "all" ? `&period=${period}` : ""}${debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ""}`;

  const { data: quotes = [], isLoading } = useQuery<QuoteRecord[]>({
    queryKey: ["quotes", period, debouncedSearch, adminApiUrl("/api/admin/quotes")],
    queryFn: async () => {
      const res = await fetch(quotesUrl);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const grouped = groupByDate(quotes);
  const totalCount = quotes.length;

  return (
    <div className="max-w-3xl space-y-4">
      {/* Header */}
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
            {totalCount > 0 ? `${totalCount} tilboð` : "Engin tilboð"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        {/* Period pills */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                period === p.value
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-300" />
          <input
            type="text"
            placeholder="Leita eftir netfangi..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
          />
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <FileText className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">
            {debouncedSearch ? "Ekkert fannst" : "Engin tilboð enn"}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {debouncedSearch
              ? `Engin tilboð passa við "${debouncedSearch}"`
              : "Tilboð birtast hér þegar viðskiptavinir senda tilboð"}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ date, items }) => (
            <div key={date}>
              {/* Date heading */}
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="w-3.5 h-3.5 text-slate-300" />
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {formatDateHeading(date)}
                </h2>
                <div className="flex-1 h-px bg-slate-100" />
                <span className="text-[11px] text-slate-400">{items.length}</span>
              </div>

              {/* Quotes */}
              <div className="space-y-1.5">
                {items.map((quote) => {
                  const isExpanded = expandedId === quote.id;
                  const itemsData = Array.isArray(quote.items) ? quote.items as QuoteItemData[] : [];

                  return (
                    <div
                      key={quote.id}
                      className={`bg-white rounded-xl border transition-all ${
                        isExpanded ? "border-slate-300 shadow-sm" : "border-slate-200"
                      }`}
                    >
                      {/* Row */}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : quote.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {quote.productNames.length > 0
                              ? quote.productNames.join(", ")
                              : "Tilboð"}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                            <span>{formatTime(quote.createdAt)}</span>
                            {quote.customerEmail && (
                              <>
                                <span className="text-slate-200">·</span>
                                <span className="flex items-center gap-0.5 text-slate-500">
                                  <Mail className="w-3 h-3" />
                                  {quote.customerEmail}
                                </span>
                              </>
                            )}
                            {itemsData.length > 0 && (
                              <>
                                <span className="text-slate-200">·</span>
                                <span className="flex items-center gap-0.5">
                                  <Package className="w-3 h-3" />
                                  {itemsData.length}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {quote.combinedTotal && quote.combinedTotal > 0 && (
                          <span className="text-sm font-bold text-slate-800 flex-shrink-0">
                            {formatPrice(Math.round(quote.combinedTotal))} kr
                          </span>
                        )}

                        <ChevronDown
                          className={`w-4 h-4 text-slate-300 transition-transform flex-shrink-0 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {/* Expanded */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                          {/* Customer email */}
                          {quote.customerEmail && (
                            <div className="flex items-center gap-2 text-sm text-slate-600 bg-blue-50 rounded-lg px-3 py-2">
                              <Mail className="w-4 h-4 text-blue-500" />
                              <span className="font-medium">{quote.customerEmail}</span>
                            </div>
                          )}

                          {/* Items */}
                          {itemsData.map((item, idx) => {
                            const unit = formatUnit(item.unit || "m2");
                            const surfLabel =
                              item.surfaceType === "floor"
                                ? "Gólf"
                                : item.surfaceType === "both"
                                ? "Gólf + veggir"
                                : "Veggir";

                            return (
                              <div
                                key={idx}
                                className="flex items-center justify-between py-2"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                    {surfLabel}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-slate-800 truncate">
                                      {item.productName}
                                    </p>
                                    <p className="text-[11px] text-slate-400">
                                      {item.area > 0 ? `${item.area.toFixed(1)} ${unit}` : ""}
                                      {item.unitPrice
                                        ? `${item.area > 0 ? " × " : ""}${formatPrice(item.unitPrice)} kr/${unit}`
                                        : ""}
                                    </p>
                                  </div>
                                </div>
                                {item.totalPrice > 0 && (
                                  <span className="text-sm font-semibold text-slate-700 flex-shrink-0 ml-3">
                                    {formatPrice(Math.round(item.totalPrice))} kr
                                  </span>
                                )}
                              </div>
                            );
                          })}

                          {/* Total */}
                          {quote.combinedTotal && quote.combinedTotal > 0 && (
                            <div className="flex items-center justify-between bg-slate-900 rounded-lg px-4 py-3">
                              <span className="text-sm font-semibold text-white">Samtals</span>
                              <span className="text-base font-bold text-white">
                                {formatPrice(Math.round(quote.combinedTotal))} kr
                              </span>
                            </div>
                          )}

                          {/* Open PDF */}
                          <a
                            href={quote.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                            Opna PDF
                          </a>
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
