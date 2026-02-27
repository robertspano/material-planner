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
    <div className="max-w-6xl space-y-10">
      {/* Overview section */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-900">{company?.name || "Yfirlit"}</h1>
          <a
            href={`/?company=${companySlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: brandColor }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Planner
          </a>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
              <Package className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats?.totalProducts || 0}</p>
              <p className="text-xs text-slate-400 mt-0.5">Vörur</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
              <Layers className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats?.generationsUsed || 0}</p>
              <p className="text-xs text-slate-400 mt-0.5">Generates</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
              <ImageIcon className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats?.totalGenerations || 0}</p>
              <p className="text-xs text-slate-400 mt-0.5">Myndir</p>
            </div>
          </div>
        </div>
      </div>

      {/* Products section */}
      <ProductsPage brandColor={brandColor} />
    </div>
  );
}
