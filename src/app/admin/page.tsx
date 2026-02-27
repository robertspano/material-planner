"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, ImageIcon, TrendingUp, Loader2, ExternalLink, ArrowRight } from "lucide-react";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyStats, CompanyBranding } from "@/types";

export default function AdminDashboard() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const { data: stats, isLoading } = useQuery<CompanyStats>({ queryKey: [adminApiUrl("/api/admin/stats")] });
  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const brandColor = company?.primaryColor || "#2e7cff";

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  const usagePercent = stats ? Math.round((stats.generationsUsed / stats.generationLimit) * 100) : 0;
  const usageColor = usagePercent > 90 ? "#ef4444" : usagePercent > 70 ? "#eab308" : brandColor;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Velkomin, {company?.name}
        </h1>
      </div>

      {/* Planner link — the main action */}
      <a
        href={`/?company=${companySlug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center justify-between p-5 rounded-2xl text-white transition-all hover:shadow-lg hover:scale-[1.01]"
        style={{ backgroundColor: brandColor }}
      >
        <div>
          <p className="text-lg font-semibold">Opna Planner</p>
          <p className="text-sm opacity-80 mt-0.5">Sjónræn áætlun fyrir viðskiptavini</p>
        </div>
        <ExternalLink className="w-5 h-5 opacity-60 group-hover:opacity-100 transition-opacity" />
      </a>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <Package className="w-5 h-5 mx-auto mb-2" style={{ color: brandColor }} />
          <p className="text-2xl font-bold text-slate-900">{stats?.totalProducts ?? 0}</p>
          <p className="text-xs text-slate-400 mt-0.5">Vörur</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <ImageIcon className="w-5 h-5 mx-auto mb-2" style={{ color: brandColor }} />
          <p className="text-2xl font-bold text-slate-900">{stats?.totalGenerations ?? 0}</p>
          <p className="text-xs text-slate-400 mt-0.5">Myndir búnar til</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <TrendingUp className="w-5 h-5 mx-auto mb-2" style={{ color: brandColor }} />
          <p className="text-2xl font-bold text-slate-900">{stats?.generationsThisMonth ?? 0}</p>
          <p className="text-xs text-slate-400 mt-0.5">Þennan mánuð</p>
        </div>
      </div>

      {/* Usage */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-slate-900">Notkun</p>
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-900">{stats?.generationsUsed ?? 0}</span> / {stats?.generationLimit ?? 0}
          </p>
        </div>
        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(usagePercent, 100)}%`,
              backgroundColor: usageColor,
            }}
          />
        </div>
        {usagePercent > 80 && (
          <p className="text-xs text-amber-600 mt-2">
            {usagePercent >= 100 ? "Hámarki náð — hafðu samband til að auka." : "Nálgast hámark mánaðarlegra myndagerða."}
          </p>
        )}
      </div>

      {/* Quick link to products */}
      <a
        href={`/admin/products${companySlug ? `?company=${companySlug}` : ""}`}
        className="group flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: brandColor + "15" }}>
            <Package className="w-4 h-4" style={{ color: brandColor }} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">Sýsla með vörur</p>
            <p className="text-xs text-slate-400">{stats?.totalProducts ?? 0} vörur í vörulista</p>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
      </a>
    </div>
  );
}
