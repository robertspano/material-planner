"use client";

import { useQuery } from "@tanstack/react-query";
import { Package, ImageIcon, Layers } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyStats, CompanyBranding } from "@/types";
import ProductsPage from "./products/page";

interface DashboardResponse {
  company: CompanyBranding;
  products: unknown[];
  categories: unknown[];
  stats: CompanyStats;
}

export default function AdminDashboard() {
  const { adminApiUrl, companySlug } = useAdminCompany();

  // Single combined fetch — one cold start instead of 5 separate API calls
  const dashboardUrl = adminApiUrl("/api/admin/dashboard");
  const { data: dashboard } = useQuery<DashboardResponse>({
    queryKey: [dashboardUrl],
    queryFn: async () => {
      const res = await fetch(dashboardUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      const data: DashboardResponse = await res.json();

      // Seed individual caches so ProductsPage gets instant data (no extra fetches)
      if (data.company) {
        queryClient.setQueryData([`/api/planner/company?company=${companySlug}`], data.company);
      }
      if (data.products) {
        queryClient.setQueryData([adminApiUrl("/api/admin/products")], data.products);
      }
      if (data.categories) {
        queryClient.setQueryData([adminApiUrl("/api/admin/categories")], data.categories);
      }

      return data;
    },
    enabled: !!companySlug,
  });

  const stats = dashboard?.stats;
  const company = dashboard?.company;
  const brandColor = company?.primaryColor || "#2e7cff";

  return (
    <div className="max-w-6xl space-y-10">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={Package} color="blue" value={stats?.totalProducts} label="Vörur" />
        <StatCard icon={Layers} color="emerald" value={stats?.generationsUsed} label="Framleiðslur" />
        <StatCard icon={ImageIcon} color="orange" value={stats?.totalGenerations} label="Myndir" />
      </div>

      {/* Products section */}
      <ProductsPage brandColor={brandColor} />
    </div>
  );
}

/* ── Stat Card ── */
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
