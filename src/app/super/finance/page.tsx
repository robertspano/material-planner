"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Zap, ImageIcon, DollarSign, Package,
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

interface DataPoint {
  date: string;
  total: number;
  revenue: number;
  [key: string]: unknown;
}

interface FinanceData {
  companies: CompanyInfo[];
  imagePoints: DataPoint[];
  generatePoints: DataPoint[];
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

// ── Helpers ──
function formatISK(amount: number): string {
  return `${amount.toLocaleString("is-IS")} kr`;
}

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "Vika" },
  { key: "month", label: "Mánuður" },
  { key: "6months", label: "6 mán." },
  { key: "year", label: "Ár" },
  { key: "all", label: "Allt" },
];

// ── Main Page ──
export default function FinancePage() {
  const [range, setRange] = useState<Range>("month");
  const [expandedCompany, setExpandedCompany] = useState<string | null>(null);

  const { data, isLoading } = useQuery<FinanceData>({
    queryKey: [`/api/super/finance?range=${range}`],
  });

  // Build per-company daily data (only for expanded company)
  const companyDailyData = useMemo(() => {
    if (!data || !expandedCompany) return [];

    const dateMap = new Map<string, { generates: number; images: number }>();

    for (const point of data.generatePoints) {
      const count = (point[expandedCompany] as number) || 0;
      if (count > 0) {
        if (!dateMap.has(point.date)) dateMap.set(point.date, { generates: 0, images: 0 });
        dateMap.get(point.date)!.generates += count;
      }
    }

    for (const point of data.imagePoints) {
      const count = (point[expandedCompany] as number) || 0;
      if (count > 0) {
        if (!dateMap.has(point.date)) dateMap.set(point.date, { generates: 0, images: 0 });
        dateMap.get(point.date)!.images += count;
      }
    }

    return [...dateMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, counts]) => ({ date, ...counts }));
  }, [data, expandedCompany]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (range === "day") {
      return d.toLocaleString("is-IS", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("is-IS", {
      weekday: "short",
      day: "numeric",
      month: "long",
      ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
    });
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
        <div className="flex items-center gap-1.5">
          <DollarSign className="w-4 h-4 text-emerald-500" />
          <span className="font-bold text-emerald-600">{formatISK(data.summary.periodRevenue)}</span>
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
                onClick={() => setExpandedCompany(isExpanded ? null : c.id)}
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
                  <span className="font-bold text-emerald-600 min-w-[70px] text-right">
                    {formatISK(c.periodRevenue)}
                  </span>
                </div>

                <ChevronDown
                  className={`w-4 h-4 text-slate-300 flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              </button>

              {/* Expanded — daily detail for this company */}
              {isExpanded && (
                <div className="border-t border-slate-100">
                  {/* Company all-time summary */}
                  <div className="px-4 py-3 bg-slate-50/50 flex items-center gap-5 text-[11px] text-slate-400 flex-wrap">
                    <span>Verð per gen: <span className="font-semibold text-slate-600">{c.pricePerGeneration} kr</span></span>
                    <span>Samtals: <span className="font-semibold text-slate-600">{c.totalGenerates} framl.</span></span>
                    <span>Samtals myndir: <span className="font-semibold text-slate-600">{c.totalImages}</span></span>
                    <span>Heildartekjur: <span className="font-semibold text-emerald-600">{formatISK(c.totalRevenue)}</span></span>
                  </div>

                  {/* Daily rows */}
                  {companyDailyData.length === 0 ? (
                    <div className="px-4 py-6 text-center text-xs text-slate-400">
                      Engin virkni á tímabili
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50 max-h-[320px] overflow-y-auto">
                      {companyDailyData.map(day => (
                        <div key={day.date} className="flex items-center justify-between px-4 py-2.5 text-xs hover:bg-slate-50/50">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-3 h-3 text-slate-300" />
                            <span className="font-medium text-slate-600">{formatDate(day.date)}</span>
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
                            <span className="font-bold text-emerald-600 min-w-[60px] text-right">
                              {formatISK(day.generates * c.pricePerGeneration)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
