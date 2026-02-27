"use client";

import { useQuery } from "@tanstack/react-query";
import { ImageIcon, TrendingUp, Loader2, ExternalLink } from "lucide-react";
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
      {/* Header row: welcome + stats + planner link */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-slate-900">
          {company?.name || "Yfirlit"}
        </h1>

        <div className="flex items-center gap-3">
          {/* Mini stats */}
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="font-semibold text-slate-900">{stats?.totalGenerations ?? 0}</span>
            <span className="text-xs">myndir</span>
          </div>
          <div className="w-px h-4 bg-slate-200" />
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="font-semibold text-slate-900">{stats?.generationsThisMonth ?? 0}</span>
            <span className="text-xs">þ. mánuð</span>
          </div>
          <div className="w-px h-4 bg-slate-200" />

          {/* Planner link */}
          <a
            href={`/?company=${companySlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: brandColor }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Planner
          </a>
        </div>
      </div>

      {/* Products section */}
      <ProductsPage />
    </div>
  );
}
