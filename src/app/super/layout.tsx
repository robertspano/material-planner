"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Paintbrush, LogOut, Loader2, LayoutDashboard, TrendingUp } from "lucide-react";
import Link from "next/link";

interface AuthAdmin {
  id: string;
  name: string;
  email: string;
  role: string;
}

const navItems = [
  { href: "/super", label: "Overview", icon: LayoutDashboard },
  { href: "/super/finance", label: "Fjarmál", icon: TrendingUp },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AuthAdmin | null>(null);
  const [checking, setChecking] = useState(true);

  // Auth guard — check on mount
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(res => {
        if (!res.ok) throw new Error("Not authenticated");
        return res.json();
      })
      .then(data => {
        if (data.admin?.role !== "super_admin") {
          router.replace("/login");
        } else {
          setAdmin(data.admin);
          setChecking(false);
        }
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const isActive = (href: string) => {
    if (href === "/super") return pathname === "/super" || pathname === "/super/companies" || pathname === "/super/admins";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm z-30">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Paintbrush className="w-4 h-4 text-white" />
            </div>
            <span className="text-slate-900 font-bold text-lg">Super Admin</span>
          </div>
          <div className="flex items-center gap-3">
            {admin && (
              <span className="text-xs text-slate-500 hidden sm:block">
                {admin.email}
              </span>
            )}
            <button onClick={handleLogout} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-red-400 hover:opacity-80">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Fixed Sidebar */}
        <aside className="fixed left-0 top-1/2 -translate-y-1/2 w-[180px] z-20">
          <nav className="p-3 space-y-1.5">
            {navItems.map(item => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                    active
                      ? "bg-purple-50 text-purple-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                  }`}
                  style={active ? { transform: "skewY(-1deg)" } : undefined}
                >
                  <div style={active ? { transform: "skewY(1deg)" } : undefined} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      active
                        ? "bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/25"
                        : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                    }`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span>{item.label}</span>
                  </div>
                  {active && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-gradient-to-b from-purple-400 to-indigo-500" />
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main content — offset by sidebar width */}
        <main className="ml-[180px] flex-1 max-w-5xl px-4 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
