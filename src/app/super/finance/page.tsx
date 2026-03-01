"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Zap, ImageIcon, Package,
  ChevronDown, Calendar,
} from "lucide-react";

// ── Types ──
type Range = "day" | "week" | "month" | "6months" | "year" | "all";

interface CompanyInfo {
  id: string;
  name: string;
  primaryColor: string;
  pricePerGeneration: number;
  totalProducts: number;
  totalImages: number;
  totalGenerates: number;
  totalRevenue: number;
  periodImages: number;
  periodGenerates: number;
  periodRevenue: number;
}

interface FinanceData {
  companies: CompanyInfo[];
  summary: {
    totalImages: number;
    totalGenerates: number;
    totalRevenue: number;
    periodImages: number;
    periodGenerates: number;
    periodRevenue: number;
  };
  range: Range;
}

interface CompanyDetail {
  companyId: string;
  since: string;
  until: string;
  totalGenerates: number;
  totalImages: number;
  daily: { date: string; generates: number; images: number }[];
}

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "Vika" },
  { key: "month", label: "Mánuður" },
  { key: "6months", label: "6 mán." },
  { key: "year", label: "Ár" },
  { key: "all", label: "Allt" },
];

function toDateStr(d: Date) {
  return d.toISOString().split("T")[0];
}

function formatDay(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("is-IS", {
    weekday: "short",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
}

// ── Main Page ──
export default function FinancePage() {
  const [range, setRange] = useState<Range>("month");
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useQuery<FinanceData>({
    queryKey: [`/api/super/finance?range=${range}`],
  });

  // Per-company detail query — fires only when company is expanded + both dates set
  const detailUrl = expandedCompany && dateFrom && dateTo
    ? `/api/super/finance/company?companyId=${expandedCompany}&since=${dateFrom}&until=${dateTo}`
    : null;

  const { data: detail, isLoading: detailLoading } = useQuery<CompanyDetail>({
    queryKey: [detailUrl],
    enabled: !!detailUrl,
  });

  const handleExpand = (companyId: string) => {
    if (expandedCompany === companyId) {
      setExpandedCompany(null);
      return;
    }
    setExpandedCompany(companyId);
    // Pre-fill: first of current month → today
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateFrom(toDateStr(firstOfMonth));
    setDateTo(toDateStr(now));
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5 pb-10">
      {/* Header + range */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-slate-900">Fjármál</h1>
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => { setRange(r.key); setExpandedCompany(null); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                range === r.key
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats — inline */}
      <div className="flex items-center gap-6 flex-wrap text-sm">
        <div className="flex items-center gap-1.5">
          <Zap className="w-4 h-4 text-blue-500" />
          <span className="font-bold text-slate-900">{data.summary.periodGenerates}</span>
          <span className="text-slate-400">framleiðslur</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ImageIcon className="w-4 h-4 text-amber-500" />
          <span className="font-bold text-slate-900">{data.summary.periodImages}</span>
          <span className="text-slate-400">myndir</span>
        </div>
      </div>

      {/* Company cards — clickable, expandable */}
      <div className="space-y-2">
        {data.companies.map(c => {
          const isExpanded = expandedCompany === c.id;

          return (
            <div
              key={c.id}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-all"
            >
              {/* Company row — clickable */}
              <button
                onClick={() => handleExpand(c.id)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.primaryColor }} />
                <span className="text-sm font-semibold text-slate-900 flex-1 truncate">{c.name}</span>

                <div className="flex items-center gap-4 text-xs tabular-nums flex-shrink-0">
                  <span className="hidden sm:flex items-center gap-1">
                    <Package className="w-3 h-3 text-slate-300" />
                    <span className="font-bold text-slate-700">{c.totalProducts}</span>
                    <span className="text-slate-400">vörur</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-blue-400" />
                    <span className="font-bold text-slate-900">{c.periodGenerates}</span>
                    <span className="text-slate-400 hidden sm:inline">framl.</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <ImageIcon className="w-3 h-3 text-amber-400" />
                    <span className="font-bold text-slate-900">{c.periodImages}</span>
                    <span className="text-slate-400 hidden sm:inline">myndir</span>
                  </span>
                </div>

                <ChevronDown
                  className={`w-4 h-4 text-slate-300 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>

              {/* Expanded — date picker + detail */}
              {isExpanded && (
                <div className="border-t border-slate-100">
                  {/* All-time summary */}
                  <div className="px-4 py-3 bg-slate-50/50 flex items-center gap-5 text-[11px] text-slate-400 flex-wrap">
                    <span>Samtals: <span className="font-semibold text-slate-600">{c.totalGenerates} framl.</span></span>
                    <span>Samtals myndir: <span className="font-semibold text-slate-600">{c.totalImages}</span></span>
                  </div>

                  {/* Date range picker */}
                  <div className="px-4 py-3 flex items-center gap-4 flex-wrap border-b border-slate-50">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 font-medium">Frá</label>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={(e) => setDateFrom(e.target.value)}
                        className="h-8 px-2 rounded-lg border border-slate-200 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-500 font-medium">Til</label>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={(e) => setDateTo(e.target.value)}
                        className="h-8 px-2 rounded-lg border border-slate-200 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-400"
                      />
                    </div>
                  </div>

                  {/* Results */}
                  {detailLoading ? (
                    <div className="px-4 py-8 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    </div>
                  ) : detail && detail.daily.length > 0 ? (
                    <div>
                      {/* Period summary */}
                      <div className="px-4 py-3 flex items-center gap-5 text-sm">
                        <span className="flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-blue-500" />
                          <span className="font-bold text-slate-900">{detail.totalGenerates}</span>
                          <span className="text-slate-400">framleiðslur</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <ImageIcon className="w-4 h-4 text-amber-500" />
                          <span className="font-bold text-slate-900">{detail.totalImages}</span>
                          <span className="text-slate-400">myndir</span>
                        </span>
                      </div>

                      {/* Daily rows */}
                      <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
                        {detail.daily.map(day => (
                          <div key={day.date} className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-slate-50/50">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3 h-3 text-slate-300" />
                              <span className="font-medium text-slate-600">{formatDay(day.date)}</span>
                            </div>
                            <div className="flex items-center gap-4 tabular-nums">
                              <span>
                                <span className="font-bold text-slate-900">{day.generates}</span>
                                <span className="text-slate-400 ml-0.5">framl.</span>
                              </span>
                              <span>
                                <span className="font-bold text-blue-600">{day.images}</span>
                                <span className="text-slate-400 ml-0.5">myndir</span>
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : detail ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-400">
                      Engin virkni á tímabili
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
