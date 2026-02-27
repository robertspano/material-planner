"use client";

import { Suspense, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, Settings, LogOut, Menu, X, Loader2 } from "lucide-react";
import { AdminCompanyProvider, useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyBranding } from "@/types";

const navItems = [
  { href: "/admin", label: "Yfirlit", icon: LayoutDashboard },
  { href: "/admin/products", label: "Vörur", icon: Package },
  { href: "/admin/settings", label: "Stillingar", icon: Settings },
];

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { companySlug, isSuperAdmin, admin, isLoading: authLoading } = useAdminCompany();

  // Auth guard
  useEffect(() => {
    if (!authLoading && !admin) {
      router.replace("/login");
    }
  }, [authLoading, admin, router]);

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

  if (authLoading || !admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex w-full h-screen overflow-hidden bg-slate-50">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-white border-b border-slate-200 z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2.5">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-7 w-auto" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: brandColor }}>
              <span className="text-white font-bold text-xs">{company?.name?.charAt(0) || "A"}</span>
            </div>
          )}
          <span className="text-slate-900 font-semibold text-sm">{company?.name || "Admin"}</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100">
          {sidebarOpen ? <X className="w-5 h-5 text-slate-600" /> : <Menu className="w-5 h-5 text-slate-600" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-56 flex flex-col bg-white border-r border-slate-200 transition-transform duration-300 lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        {/* Logo */}
        <div className="h-14 hidden lg:flex items-center gap-2.5 px-4 border-b border-slate-100">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-7 w-auto" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: brandColor }}>
              <span className="text-white font-bold text-xs">{company?.name?.charAt(0) || "A"}</span>
            </div>
          )}
          <span className="text-slate-900 font-semibold text-sm">{company?.name || "Admin"}</span>
          {isSuperAdmin && (
            <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded font-medium ml-auto">SA</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 mt-14 lg:mt-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => { router.push(`${item.href}${queryString}`); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  isActive
                    ? "font-semibold text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                }`}
                style={isActive ? { backgroundColor: brandColor } : undefined}
              >
                <Icon className="w-4.5 h-4.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-slate-100">
          <div className="px-3 py-2 mb-2">
            <p className="text-xs font-medium text-slate-900 truncate">{admin?.name}</p>
            <p className="text-[11px] text-slate-400 truncate">{admin?.email}</p>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <LogOut className="w-4 h-4" />
            <span>Útskrá</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <main className="flex-1 overflow-auto p-4 lg:p-8 mt-14 lg:mt-0">
        {children}
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
