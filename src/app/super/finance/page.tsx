"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign, TrendingUp, ImageIcon, Loader2, BarChart3, Zap,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

// ── Types ───────────────────────────────────────────────────────────
type Range = "day" | "week" | "month" | "6months" | "year" | "all";
type ChartView = "generates" | "images";

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

// ── Helpers ─────────────────────────────────────────────────────────
function formatISK(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M kr`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)}þ kr`;
  return `${amount.toLocaleString("is-IS")} kr`;
}

function formatDateLabel(isoDate: string, range: Range): string {
  const d = new Date(isoDate);
  switch (range) {
    case "day":
      return `${d.getUTCHours().toString().padStart(2, "0")}:00`;
    case "week":
    case "month":
      return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
    case "6months":
      return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
    case "year":
    case "all": {
      const months = ["jan", "feb", "mar", "apr", "maí", "jún", "júl", "ágú", "sep", "okt", "nóv", "des"];
      const yr = d.getUTCFullYear().toString().slice(-2);
      return range === "all" ? `${months[d.getUTCMonth()]} '${yr}` : months[d.getUTCMonth()];
    }
    default:
      return isoDate;
  }
}

function rangePeriodLabel(range: Range): string {
  switch (range) {
    case "day": return "Síðasta sólarhringinn";
    case "week": return "Síðustu 7 daga";
    case "month": return "Síðasta mánuðinn";
    case "6months": return "Síðustu 6 mánuði";
    case "year": return "Síðasta árið";
    case "all": return "Allan tíma";
    default: return "";
  }
}

// ── Tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, range, companies, selectedIds, view }: {
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: string;
  range: Range;
  companies: CompanyInfo[];
  selectedIds: Set<string>;
  view: ChartView;
}) {
  if (!active || !payload?.length) return null;
  const nameMap = new Map(companies.map(c => [c.id, c.name]));
  const items = payload.filter(p => p.value > 0 && selectedIds.has(p.dataKey as string));
  const total = items.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xl min-w-[140px]">
      <p className="text-[10px] font-medium text-slate-400 mb-1.5">
        {label ? formatDateLabel(label, range) : ""}
      </p>
      {items.sort((a, b) => b.value - a.value).map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-xs text-slate-600">{nameMap.get(entry.dataKey) || entry.dataKey}</span>
          </div>
          <span className="text-xs font-bold text-slate-900 tabular-nums">{entry.value}</span>
        </div>
      ))}
      {items.length > 1 && (
        <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between">
          <span className="text-[10px] text-slate-400">Samtals</span>
          <span className="text-xs font-bold text-slate-900">{total}</span>
        </div>
      )}
      <p className="text-[9px] text-slate-300 mt-1">
        {view === "generates" ? "generates" : "myndir"}
      </p>
    </div>
  );
}

function RevTooltip({ active, payload, label, range }: {
  active?: boolean;
  payload?: { value: number; name: string; color: string }[];
  label?: string;
  range: Range;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xl">
      <p className="text-[10px] font-medium text-slate-400 mb-1">
        {label ? formatDateLabel(label, range) : ""}
      </p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-xs font-bold text-slate-900">{formatISK(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 relative overflow-hidden">
      <div className="absolute -top-8 -right-8 w-20 h-20 rounded-full opacity-[0.07]" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label}</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{value}</p>
          {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────
const RANGES: { key: Range; label: string }[] = [
  { key: "day", label: "Dagur" },
  { key: "week", label: "Vika" },
  { key: "month", label: "Mánuður" },
  { key: "6months", label: "6 mán." },
  { key: "year", label: "Ár" },
  { key: "all", label: "Allt" },
];

export default function FinancePage() {
  const [range, setRange] = useState<Range>("month");
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [chartView, setChartView] = useState<ChartView>("generates");

  const { data, isLoading } = useQuery<FinanceData>({
    queryKey: [`/api/super/finance?range=${range}`],
  });

  const visibleIds = useMemo(() => {
    if (!data) return new Set<string>();
    if (selectedCompanies.length === 0) return new Set(data.companies.map(c => c.id));
    return new Set(selectedCompanies);
  }, [data, selectedCompanies]);

  // Pick the right points array based on view
  const activePoints = useMemo(() => {
    if (!data) return [];
    const raw = chartView === "generates" ? data.generatePoints : data.imagePoints;
    return raw.map(p => ({ ...p, label: formatDateLabel(p.date, range) }));
  }, [data, range, chartView]);

  // Revenue chart data — always based on generates
  const revenueChartData = useMemo(() => {
    if (!data) return [];
    return data.generatePoints.map(p => {
      let filteredRevenue = 0;
      const priceMap = new Map(data.companies.map(c => [c.id, c.pricePerGeneration]));
      for (const cid of visibleIds) {
        const count = (p[cid] as number) || 0;
        filteredRevenue += count * (priceMap.get(cid) || 0);
      }
      return {
        date: p.date,
        label: formatDateLabel(p.date, range),
        revenue: filteredRevenue,
      };
    });
  }, [data, range, visibleIds]);

  // Filtered period stats
  const filteredStats = useMemo(() => {
    if (!data) return { generates: 0, images: 0, revenue: 0, avgPerGen: 0 };
    const sel = selectedCompanies.length === 0 ? data.companies : data.companies.filter(c => selectedCompanies.includes(c.id));
    const generates = sel.reduce((s, c) => s + c.periodGenerates, 0);
    const images = sel.reduce((s, c) => s + c.periodImages, 0);
    const revenue = sel.reduce((s, c) => s + c.periodRevenue, 0);
    const totalGens = sel.reduce((s, c) => s + c.totalGenerates, 0);
    const totalRev = sel.reduce((s, c) => s + c.totalRevenue, 0);
    const avgPerGen = totalGens > 0 ? Math.round(totalRev / totalGens) : 0;
    return { generates, images, revenue, avgPerGen };
  }, [data, selectedCompanies]);

  const activeTotal = chartView === "generates" ? filteredStats.generates : filteredStats.images;

  const toggleCompany = (id: string) => {
    setSelectedCompanies(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-5 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Fjármál</h1>
        <p className="text-sm text-slate-500 mt-0.5">Tekjur og notkun</p>
      </div>

      {/* Time range pills */}
      <div className="flex items-center gap-2 flex-wrap">
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
        <span className="text-xs text-slate-400 ml-1">{rangePeriodLabel(range)}</span>
      </div>

      {/* Stat cards — 5 cards: revenue, period revenue, generates, images, avg */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard
          label="Heildartekjur"
          value={formatISK(data.summary.totalRevenue)}
          icon={DollarSign}
          color="#8b5cf6"
        />
        <StatCard
          label="Tekjur tímabils"
          value={formatISK(filteredStats.revenue)}
          sub={rangePeriodLabel(range)}
          icon={TrendingUp}
          color="#10b981"
        />
        <StatCard
          label="Generates"
          value={filteredStats.generates.toLocaleString("is-IS")}
          sub={rangePeriodLabel(range)}
          icon={Zap}
          color="#3b82f6"
        />
        <StatCard
          label="Myndir"
          value={filteredStats.images.toLocaleString("is-IS")}
          sub={rangePeriodLabel(range)}
          icon={ImageIcon}
          color="#f59e0b"
        />
        <StatCard
          label="Meðalverð / gen"
          value={`${filteredStats.avgPerGen} kr`}
          icon={BarChart3}
          color="#ec4899"
        />
      </div>

      {/* Company filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-slate-400">Fyrirtæki:</span>
        <button
          onClick={() => setSelectedCompanies([])}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
            selectedCompanies.length === 0
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
          }`}
        >
          Öll
        </button>
        {data.companies.map(c => {
          const isSelected = selectedCompanies.includes(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggleCompany(c.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border ${
                isSelected
                  ? "text-white border-transparent"
                  : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
              }`}
              style={isSelected ? { backgroundColor: c.primaryColor, borderColor: c.primaryColor } : undefined}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: isSelected ? "#fff" : c.primaryColor }}
              />
              {c.name}
              <span className={`text-[10px] ${isSelected ? "text-white/70" : "text-slate-300"}`}>
                {c.periodGenerates}
              </span>
            </button>
          );
        })}
      </div>

      {/* Generates / Images Chart */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Toggle between generates and images */}
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setChartView("generates")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  chartView === "generates"
                    ? "bg-blue-600 text-white shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Generates
              </button>
              <button
                onClick={() => setChartView("images")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  chartView === "images"
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-slate-500"
                }`}
              >
                Myndir
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              {selectedCompanies.length === 0
                ? "Öll fyrirtæki"
                : selectedCompanies.length === 1
                  ? data.companies.find(c => c.id === selectedCompanies[0])?.name
                  : `${selectedCompanies.length} fyrirtæki`}
            </p>
          </div>
          <span className="text-lg font-bold text-slate-900 tabular-nums">
            {activeTotal.toLocaleString("is-IS")}
          </span>
        </div>
        {activePoints.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center">
            <p className="text-sm text-slate-300">Engin gögn</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={activePoints} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                {data.companies.filter(c => visibleIds.has(c.id)).map(company => (
                  <linearGradient key={`grad-${company.id}`} id={`grad-${company.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={company.primaryColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={company.primaryColor} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.1)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                interval={range === "day" ? 2 : range === "month" ? 2 : "preserveStartEnd"}
              />
              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                content={<ChartTooltip range={range} companies={data.companies} selectedIds={visibleIds} view={chartView} />}
                cursor={{ stroke: "rgba(100,116,139,0.2)" }}
              />
              {data.companies
                .filter(c => visibleIds.has(c.id))
                .map((company) => (
                  <Area
                    key={company.id}
                    type="monotone"
                    dataKey={company.id}
                    stackId="main"
                    stroke={company.primaryColor}
                    strokeWidth={2}
                    fill={`url(#grad-${company.id})`}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 1.5, stroke: company.primaryColor, fill: "#fff" }}
                  />
                ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Revenue Chart — always based on generates × price */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tekjur</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">Reiknað: generates × verð per generate</p>
          </div>
          <span className="text-lg font-bold text-emerald-600 tabular-nums">
            {formatISK(filteredStats.revenue)}
          </span>
        </div>
        {revenueChartData.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center">
            <p className="text-sm text-slate-300">Engin gögn</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueChartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,0.1)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                interval={range === "day" ? 2 : range === "month" ? 2 : "preserveStartEnd"}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => formatISK(v)}
              />
              <Tooltip content={<RevTooltip range={range} />} cursor={{ stroke: "rgba(100,116,139,0.2)" }} />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Tekjur"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#revGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "#10b981", fill: "#fff" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Company breakdown — compact table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Yfirlit fyrirtækja</h2>
        <div className="space-y-2">
          {data.companies.map(c => {
            const pct = data.summary.periodGenerates > 0
              ? (c.periodGenerates / data.summary.periodGenerates) * 100
              : 0;
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 py-2 px-3 rounded-lg bg-slate-50"
              >
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.primaryColor }} />
                <span className="text-sm font-medium text-slate-900 min-w-[100px]">{c.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: c.primaryColor }}
                  />
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 text-right">
                  <div>
                    <span className="text-xs font-semibold text-slate-900 tabular-nums">{c.periodGenerates}</span>
                    <span className="text-[9px] text-slate-400 ml-0.5">gen</span>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-blue-600 tabular-nums">{c.periodImages}</span>
                    <span className="text-[9px] text-slate-400 ml-0.5">myndir</span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 tabular-nums w-20 text-right">
                    {formatISK(c.periodRevenue)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
