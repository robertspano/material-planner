"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { AdminCompanyProvider, useAdminCompany } from "@/components/admin/admin-company-context";
import { queryClient } from "@/lib/queryClient";
import type { CompanyBranding } from "@/types";

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const { companySlug, isSuperAdmin, admin, isLoading: authLoading, adminApiUrl } = useAdminCompany();

  // Auth guard
  useEffect(() => {
    if (!authLoading && !admin) {
      router.replace("/login");
    }
  }, [authLoading, admin, router]);

  // Prefetch all admin data
  useEffect(() => {
    if (admin && companySlug) {
      queryClient.prefetchQuery({ queryKey: [`/api/planner/company?company=${companySlug}`] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/stats")] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/products")] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/categories")] });
    }
  }, [admin, companySlug, adminApiUrl]);

  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const brandColor = company?.primaryColor || "#2e7cff";
  const showContent = !authLoading && !!admin;

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ '--primary': brandColor, '--ring': brandColor } as React.CSSProperties}
    >
      {/* Top bar — logo + logout */}
      <div className="flex items-center justify-between px-4 lg:px-8 pt-4 lg:pt-6">
        <div className="flex items-center gap-3">
          {company?.logoUrl ? (
            <div
              className="h-10 px-5 rounded-xl flex items-center"
              style={{ backgroundColor: brandColor }}
            >
              <img
                src={company.logoUrl}
                alt={company.name}
                className="h-6 w-auto max-w-[140px] object-contain brightness-0 invert"
              />
            </div>
          ) : company?.name ? (
            <div
              className="h-10 px-5 rounded-xl flex items-center"
              style={{ backgroundColor: brandColor }}
            >
              <span className="font-bold text-white text-sm">{company.name}</span>
            </div>
          ) : (
            <div className="h-10 w-32 bg-slate-200 rounded-xl animate-pulse" />
          )}
          {isSuperAdmin && (
            <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">SA</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {admin && (
            <span className="text-xs text-slate-400 hidden sm:block">{admin.name}</span>
          )}
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Útskrá"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content — full width */}
      <main className="px-4 lg:px-8 py-6">
        {showContent ? children : null}
      </main>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AdminCompanyProvider>
        <AdminLayoutInner>{children}</AdminLayoutInner>
      </AdminCompanyProvider>
    </Suspense>
  );
}
