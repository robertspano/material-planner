"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, ImageIcon, Layers, ExternalLink } from "lucide-react";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyStats, CompanyBranding } from "@/types";
import ProductsPage from "./products/page";

export default function AdminDashboard() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const { data: stats } = useQuery<CompanyStats>({ queryKey: [adminApiUrl("/api/admin/stats")] });
  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const brandColor = company?.primaryColor || "#2e7cff";

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
          <StatCard icon={Package} color="blue" value={stats?.totalProducts} label="Vörur" />
          <StatCard icon={Layers} color="emerald" value={stats?.generationsUsed} label="Generates" />
          <StatCard icon={ImageIcon} color="orange" value={stats?.totalGenerations} label="Myndir" />
        </div>
      </div>

      {/* Products section */}
      <ProductsPage brandColor={brandColor} />
    </div>
  );
}

const colorMap = {
  blue: { bg: "bg-blue-500/15", text: "text-blue-500" },
  emerald: { bg: "bg-emerald-500/15", text: "text-emerald-500" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-500" },
};

function StatCard({ icon: Icon, color, value, label }: {
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "emerald" | "orange";
  value: number | undefined;
  label: string;
}) {
  const c = colorMap[color];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${c.text}`} />
      </div>
      <div>
        {value !== undefined ? (
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        ) : (
          <div className="h-7 w-10 bg-slate-100 rounded animate-pulse" />
        )}
        <p className="text-xs text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
