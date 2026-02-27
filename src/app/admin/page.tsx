"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, FolderOpen, ImageIcon, TrendingUp, Loader2, BarChart3, Eye } from "lucide-react";
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
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin dark:text-slate-400" /></div>;
  }

  const cards = [
    { label: "Vörur", value: stats?.totalProducts ?? 0, icon: Package },
    { label: "Flokkar", value: stats?.totalCategories ?? 0, icon: FolderOpen },
    { label: "Myndir", value: stats?.totalGenerations ?? 0, icon: ImageIcon },
    { label: "Þennan mánuð", value: stats?.generationsThisMonth ?? 0, icon: TrendingUp },
  ];

  const usagePercent = stats ? Math.round((stats.generationsUsed / stats.generationLimit) * 100) : 0;

  return (
    <div className="max-w-4xl space-y-6">
      {/* Welcome header */}
      <div>
        <h1 className="text-xl lg:text-2xl font-bold dark:text-white text-slate-900">
          Stjórnborð
        </h1>
        <p className="text-sm dark:text-slate-400 text-slate-500 mt-1">
          Yfirlit yfir {company?.name || "fyrirtækið"}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-4 lg:p-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: brandColor + "20" }}
                >
                  <Icon className="w-5 h-5" style={{ color: brandColor }} />
                </div>
                <div>
                  <p className="text-xl lg:text-2xl font-bold dark:text-white text-slate-900">{card.value}</p>
                  <p className="text-xs dark:text-slate-400 text-slate-500">{card.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Usage Meter */}
      <div className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-6">
        <h2 className="text-lg font-semibold dark:text-white text-slate-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" style={{ color: brandColor }} />
          Mánaðarleg notkun
        </h2>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm dark:text-slate-400 text-slate-500">
            {stats?.generationsUsed ?? 0} / {stats?.generationLimit ?? 0} myndagerðir
          </span>
          <span className="text-sm font-medium dark:text-white text-slate-900">{usagePercent}%</span>
        </div>
        <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(usagePercent, 100)}%`,
              backgroundColor: usagePercent > 90 ? "#ef4444" : usagePercent > 70 ? "#eab308" : brandColor,
            }}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-6">
        <h2 className="text-lg font-semibold dark:text-white text-slate-900 mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5" style={{ color: brandColor }} />
          Flýtiaðgerðir
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href={`/?company=${companySlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl border dark:border-slate-700/50 border-slate-200 dark:hover:bg-slate-700/50 hover:bg-slate-50 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: brandColor + "20" }}>
              <Eye className="w-4 h-4" style={{ color: brandColor }} />
            </div>
            <div>
              <p className="font-medium dark:text-white text-slate-900 text-sm">Skoða planner</p>
              <p className="text-xs dark:text-slate-400 text-slate-500">Opna sjónræna áætlun viðskiptavina</p>
            </div>
          </a>
          <a
            href={`/admin/products?company=${companySlug}`}
            className="flex items-center gap-3 p-4 rounded-xl border dark:border-slate-700/50 border-slate-200 dark:hover:bg-slate-700/50 hover:bg-slate-50 transition-colors"
          >
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: brandColor + "20" }}>
              <Package className="w-4 h-4" style={{ color: brandColor }} />
            </div>
            <div>
              <p className="font-medium dark:text-white text-slate-900 text-sm">Sýsla með vörur</p>
              <p className="text-xs dark:text-slate-400 text-slate-500">{stats?.totalProducts ?? 0} vörur í vörulista</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
