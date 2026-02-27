"use client";

import { Suspense, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Settings, LogOut, Menu, X } from "lucide-react";
import { AdminCompanyProvider, useAdminCompany } from "@/components/admin/admin-company-context";
import { queryClient } from "@/lib/queryClient";
import type { CompanyBranding } from "@/types";

const navItems = [
  { href: "/admin", label: "Yfirlit", icon: LayoutDashboard },
  { href: "/admin/settings", label: "Stillingar", icon: Settings },
];

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { companySlug, isSuperAdmin, admin, isLoading: authLoading, adminApiUrl } = useAdminCompany();

  // Auth guard — redirect only when we KNOW user is not logged in
  useEffect(() => {
    if (!authLoading && !admin) {
      router.replace("/login");
    }
  }, [authLoading, admin, router]);

  // Prefetch all admin data as soon as auth is ready — so pages render instantly
  useEffect(() => {
    if (admin && companySlug) {
      queryClient.prefetchQuery({ queryKey: [`/api/planner/company?company=${companySlug}`] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/stats")] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/products")] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/categories")] });
    }
  }, [admin, companySlug, adminApiUrl]);

  const companyParam = searchParams.get("company");
  const queryString = companyParam ? `?company=${companyParam}` : "";

  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const brandColor = company?.primaryColor || "#2e7cff";

  // Show layout skeleton during auth load — NOT a blank spinner
  const showContent = !authLoading && !!admin;

  return (
    <div
      className="flex w-full h-screen overflow-hidden bg-slate-50"
      style={{ '--primary': brandColor, '--ring': brandColor } as React.CSSProperties}
    >
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          {company?.logoUrl ? (
            <div className="h-8 px-4 rounded-lg flex items-center" style={{ backgroundColor: brandColor }}>
              <img src={company.logoUrl} alt={company.name} className="h-5 w-auto max-w-[120px] object-contain brightness-0 invert" />
            </div>
          ) : company?.name ? (
            <span className="font-bold text-sm" style={{ color: brandColor }}>{company.name}</span>
          ) : (
            <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
          )}
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100">
          {sidebarOpen ? <X className="w-5 h-5 text-slate-600" /> : <Menu className="w-5 h-5 text-slate-600" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-56 flex flex-col bg-white border-r border-slate-200 transition-transform duration-300 lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Company logo */}
        <div
          className="h-14 hidden lg:flex items-center px-5 border-b border-slate-100"
          style={company?.logoUrl ? { backgroundColor: brandColor } : undefined}
        >
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-6 w-auto max-w-[140px] object-contain brightness-0 invert" />
          ) : company?.name ? (
            <span className="font-bold text-lg" style={{ color: brandColor }}>{company.name}</span>
          ) : (
            <div className="h-5 w-28 bg-slate-100 rounded animate-pulse" />
          )}
          {isSuperAdmin && (
            <span className="text-[9px] bg-white/20 text-white px-1.5 py-0.5 rounded font-medium ml-auto">SA</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 mt-14 lg:mt-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={`${item.href}${queryString}`}
                prefetch={true}
                onClick={() => setSidebarOpen(false)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "font-semibold text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`}
                style={isActive ? { backgroundColor: brandColor } : undefined}
              >
                <Icon className="w-4.5 h-4.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-slate-100">
          <div className="px-3 py-2 mb-2">
            {admin ? (
              <>
                <p className="text-xs font-medium text-slate-900 truncate">{admin.name}</p>
                <p className="text-[11px] text-slate-400 truncate">{admin.email}</p>
              </>
            ) : (
              <>
                <div className="h-3 w-24 bg-slate-100 rounded animate-pulse mb-1.5" />
                <div className="h-2.5 w-32 bg-slate-100 rounded animate-pulse" />
              </>
            )}
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Útskrá</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <main className="flex-1 overflow-auto p-4 lg:p-8 mt-14 lg:mt-0">
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
