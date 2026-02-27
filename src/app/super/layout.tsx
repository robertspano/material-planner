"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Moon, Sun, Paintbrush, LogOut, Loader2, LayoutDashboard, TrendingUp } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import Link from "next/link";

interface AuthAdmin {
  id: string;
  name: string;
  email: string;
  role: string;
}

const navItems = [
  { href: "/super", label: "Overview", icon: LayoutDashboard },
  { href: "/super/finance", label: "Fjármál", icon: TrendingUp },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
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
      <div className="min-h-screen flex items-center justify-center dark:bg-[#0E172A] bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const isActive = (href: string) => {
    if (href === "/super") return pathname === "/super" || pathname === "/super/companies" || pathname === "/super/admins";
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen dark:bg-gradient-to-b dark:from-[#0E172A] dark:via-[#131C2E] dark:to-[#1A253C] bg-gradient-to-b from-slate-50 via-white to-slate-50">
      {/* Header */}
      <header className="border-b dark:border-slate-800 border-slate-200 dark:bg-[#0E172A]/80 bg-white/80 backdrop-blur-sm z-30">
        <div className="max-w-[1400px] mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Paintbrush className="w-4 h-4 text-white" />
            </div>
            <span className="dark:text-white text-slate-900 font-bold text-lg">Super Admin</span>
          </div>
          <div className="flex items-center gap-3">
            {admin && (
              <span className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
                {admin.email}
              </span>
            )}
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="w-8 h-8 rounded-lg dark:bg-slate-800 bg-slate-100 flex items-center justify-center dark:text-slate-300 text-slate-600 hover:opacity-80"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button onClick={handleLogout} className="w-8 h-8 rounded-lg dark:bg-slate-800 bg-slate-100 flex items-center justify-center text-red-400 hover:opacity-80">
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
                      ? "dark:bg-purple-500/15 bg-purple-50 dark:text-purple-300 text-purple-700 shadow-sm"
                      : "dark:text-slate-400 text-slate-500 dark:hover:text-slate-200 hover:text-slate-800 dark:hover:bg-slate-800/50 hover:bg-slate-100"
                  }`}
                  style={active ? { transform: "skewY(-1deg)" } : undefined}
                >
                  <div style={active ? { transform: "skewY(1deg)" } : undefined} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      active
                        ? "bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-md shadow-purple-500/25"
                        : "dark:bg-slate-800 bg-slate-100 dark:text-slate-400 text-slate-500 group-hover:dark:bg-slate-700 group-hover:bg-slate-200"
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
