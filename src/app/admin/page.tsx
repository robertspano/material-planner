"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, ImageIcon, Layers, Loader2, ExternalLink } from "lucide-react";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyStats, CompanyBranding } from "@/types";
import ProductsPage from "./products/page";

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

  return (
    <div className="max-w-6xl space-y-6">
      {/* Stats cards + Planner link */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="grid grid-cols-3 gap-3 flex-1">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{stats?.totalProducts || 0}</p>
              <p className="text-xs text-slate-500">Vörur</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Layers className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{stats?.generationsUsed || 0}</p>
              <p className="text-xs text-slate-500">Generates</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{stats?.totalGenerations || 0}</p>
              <p className="text-xs text-slate-500">Myndir</p>
            </div>
          </div>
        </div>

        {/* Planner link */}
        <a
          href={`/?company=${companySlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors hover:opacity-90 whitespace-nowrap"
          style={{ backgroundColor: brandColor }}
        >
          <ExternalLink className="w-4 h-4" />
          Planner
        </a>
      </div>

      {/* Products section */}
      <ProductsPage />
    </div>
  );
}
