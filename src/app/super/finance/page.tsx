"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Calendar, Zap, ImageIcon, DollarSign } from "lucide-react";

// ── Types ──
type Range = "day" | "week" | "month" | "6months" | "year" | "all";

interface CompanyInfo {
  id: string;
  name: string;
  primaryColor: string;
  pricePerGeneration: number;
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

  const { data, isLoading } = useQuery<FinanceData>({
    queryKey: [`/api/super/finance?range=${range}`],
  });

  // Build daily activity from generatePoints and imagePoints
  const dailyActivity = useMemo(() => {
    if (!data) return [];

    const dateMap = new Map<string, Map<string, { generates: number; images: number }>>();

    for (const point of data.generatePoints) {
      if (!dateMap.has(point.date)) dateMap.set(point.date, new Map());
      const companyMap = dateMap.get(point.date)!;
      for (const company of data.companies) {
        const count = (point[company.id] as number) || 0;
        if (count > 0) {
          if (!companyMap.has(company.id)) companyMap.set(company.id, { generates: 0, images: 0 });
          companyMap.get(company.id)!.generates += count;
        }
      }
    }

    for (const point of data.imagePoints) {
      if (!dateMap.has(point.date)) dateMap.set(point.date, new Map());
      const companyMap = dateMap.get(point.date)!;
      for (const company of data.companies) {
        const count = (point[company.id] as number) || 0;
        if (count > 0) {
          if (!companyMap.has(company.id)) companyMap.set(company.id, { generates: 0, images: 0 });
          companyMap.get(company.id)!.images += count;
        }
      }
    }

    return [...dateMap.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, companyMap]) => ({
        date,
        companies: [...companyMap.entries()]
          .map(([companyId, counts]) => ({
            companyId,
            company: data.companies.find(c => c.id === companyId)!,
            ...counts,
          }))
          .sort((a, b) => b.generates - a.generates),
      }));
  }, [data]);

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
              onClick={() => setRange(r.key)}
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

      {/* Company summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.companies.map(c => (
          <div key={c.id} className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.primaryColor }} />
            <span className="text-sm font-semibold text-slate-900 flex-1 truncate">{c.name}</span>
            <div className="flex items-center gap-3 text-xs tabular-nums flex-shrink-0">
              <span>
                <span className="font-bold text-slate-900">{c.periodGenerates}</span>
                <span className="text-slate-400 ml-0.5">framl.</span>
              </span>
              <span>
                <span className="font-bold text-blue-600">{c.periodImages}</span>
                <span className="text-slate-400 ml-0.5">myndir</span>
              </span>
              <span className="font-bold text-emerald-600 min-w-[60px] text-right">{formatISK(c.periodRevenue)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Daily breakdown */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Dagleg virkni</h2>
        </div>
        {dailyActivity.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">Engin virkni á tímabili</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {dailyActivity.map(day => {
              const dayGenerates = day.companies.reduce((s, c) => s + c.generates, 0);
              const dayImages = day.companies.reduce((s, c) => s + c.images, 0);
              const dayRevenue = day.companies.reduce((s, c) => s + c.generates * c.company.pricePerGeneration, 0);

              return (
                <div key={day.date} className="px-4 py-3">
                  {/* Date header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-300" />
                      <span className="text-xs font-semibold text-slate-600">{formatDate(day.date)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400 tabular-nums">
                      <span>{dayGenerates} framl.</span>
                      <span>{dayImages} myndir</span>
                      <span className="text-emerald-500 font-medium">{formatISK(dayRevenue)}</span>
                    </div>
                  </div>

                  {/* Per-company rows */}
                  <div className="space-y-1 ml-5">
                    {day.companies.map(({ companyId, company, generates, images }) => (
                      <div key={companyId} className="flex items-center gap-3 text-xs">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: company.primaryColor }} />
                        <span className="text-slate-700 min-w-[90px] truncate">{company.name}</span>
                        <span className="tabular-nums">
                          <span className="font-semibold text-slate-900">{generates}</span>
                          <span className="text-slate-400 ml-0.5">framl.</span>
                        </span>
                        <span className="tabular-nums">
                          <span className="font-semibold text-blue-600">{images}</span>
                          <span className="text-slate-400 ml-0.5">myndir</span>
                        </span>
                        <span className="font-semibold text-emerald-600 tabular-nums ml-auto">
                          {formatISK(generates * company.pricePerGeneration)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
