"use client";

import { Suspense, useState, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Package, FolderOpen, Settings, Paintbrush, LogOut, X, Loader2 } from "lucide-react";
import { AdminCompanyProvider, useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyBranding } from "@/types";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/products", label: "Products", icon: Package },
  { href: "/admin/categories", label: "Categories", icon: FolderOpen },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { companySlug, isSuperAdmin, admin, isLoading: authLoading } = useAdminCompany();

  // Auth guard — redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !admin) {
      router.replace("/login");
    }
  }, [authLoading, admin, router]);

  // Build query string to preserve company param in nav links
  const companyParam = searchParams.get("company");
  const queryString = companyParam ? `?company=${companyParam}` : "";

  // Fetch company branding using the resolved company slug
  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const brandColor = company?.primaryColor || "#2e7cff";

  // Show loading while checking auth
  if (authLoading || !admin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex w-full h-screen overflow-hidden bg-gradient-to-b from-slate-100 via-slate-50 to-white">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-50 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-8 w-auto" />
          ) : (
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)` }}>
              <Paintbrush className="w-4 h-4 text-white" />
            </div>
          )}
          <span className="text-slate-900 font-bold">{company?.name || "Admin"}</span>
          {isSuperAdmin && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">Super Admin</span>
          )}
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-slate-600">
          {sidebarOpen ? <X className="w-6 h-6" /> : <LayoutDashboard className="w-6 h-6" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 flex flex-col bg-white border-r border-slate-200 transition-transform duration-300 lg:relative lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="h-16 hidden lg:flex items-center gap-3 px-5 border-b border-slate-200">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-8 w-auto" />
          ) : (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)` }}>
              <Paintbrush className="w-5 h-5 text-white" />
            </div>
          )}
          <div>
            <span className="text-slate-900 font-bold text-lg block leading-tight">{company?.name || "Admin"}</span>
            {isSuperAdmin && (
              <span className="text-[10px] text-amber-400 font-medium">Super Admin</span>
            )}
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 mt-16 lg:mt-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <button
                key={item.href}
                onClick={() => { router.push(`${item.href}${queryString}`); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive ? "bg-opacity-20" : "text-slate-600 hover:bg-slate-100"
                }`}
                style={isActive ? { backgroundColor: brandColor + "20", color: brandColor } : undefined}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <main className="flex-1 overflow-auto p-4 lg:p-8 mt-16 lg:mt-0">
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
