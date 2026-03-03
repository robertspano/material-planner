"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText, Calendar, ExternalLink,
  ArrowLeft, Search, Loader2, Mail,
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

function groupByDate(quotes: QuoteRecord[]) {
  const groups = new Map<string, QuoteRecord[]>();
  for (const q of quotes) {
    const key = new Date(q.createdAt).toISOString().split("T")[0];
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
  if (d.toDateString() === today.toDateString()) return "I dag";
  if (d.toDateString() === yesterday.toDateString()) return "I gær";
  return d.toLocaleDateString("is-IS", {
    weekday: "long", day: "numeric", month: "long",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("is-IS", { hour: "2-digit", minute: "2-digit" });
}

function formatPrice(n: number): string {
  return n.toLocaleString("is-IS");
}

export default function TilbodPage() {
  const { adminApiUrl, companySlug } = useAdminCompany();

  const [period, setPeriod] = useState<string>("month");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

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
            {quotes.length > 0 ? `${quotes.length} tilboð` : "Engin tilboð"}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
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

              {/* Quote cards — flat, no expand */}
              <div className="space-y-1.5">
                {items.map((quote) => {
                  const itemsData = Array.isArray(quote.items) ? quote.items as QuoteItemData[] : [];

                  return (
                    <div
                      key={quote.id}
                      className="bg-white rounded-xl border border-slate-200 px-4 py-3 space-y-2"
                    >
                      {/* Top: product + time + email + price */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {quote.productNames.length > 0
                              ? quote.productNames.join(", ")
                              : "Tilboð"}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
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
                            {itemsData.length > 1 && (
                              <>
                                <span className="text-slate-200">·</span>
                                <span>{itemsData.length} vörur</span>
                              </>
                            )}
                          </div>
                        </div>

                        {quote.combinedTotal && quote.combinedTotal > 0 && (
                          <span className="text-sm font-bold text-emerald-600 flex-shrink-0">
                            {formatPrice(Math.round(quote.combinedTotal))} kr
                          </span>
                        )}
                      </div>

                      {/* Open PDF — centered */}
                      <a
                        href={quote.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg text-xs font-medium text-slate-500 bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Opna PDF
                      </a>
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
