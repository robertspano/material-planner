"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";

interface CompanyBranding {
  name: string;
  logoUrl: string | null;
  loginBackgroundUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export default function LoginForm({ company }: { company: CompanyBranding | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Login failed");
        return;
      }

      const data = await res.json();
      queryClient.setQueryData(["/api/auth/me"], data);

      if (data.admin.role === "super_admin") {
        router.push("/super");
      } else {
        router.push("/admin");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  const hasBackground = !!company?.loginBackgroundUrl;

  // ----- Generic login (no company or no background) -----
  if (!hasBackground) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-sky-100 p-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt={company.name} className="h-10 max-w-[200px] object-contain" />
            ) : (
              <>
                <div className="w-8 h-8 bg-slate-900 rounded-md flex items-center justify-center">
                  <span className="text-white font-bold text-xs">S</span>
                </div>
                <span className="text-lg font-medium tracking-tight text-slate-900">snið</span>
              </>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-lg">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="email">Netfang</Label>
                <Input id="email" type="email" placeholder="admin@fyrirtæki.is" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Lykilorð</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1" />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Skrái inn..." : "Skrá inn"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ----- Branded login with background image -----
  // Full-bleed background with floating card overlay (Landsbankinn-style)
  return (
    <div
      className="min-h-screen w-full bg-cover bg-center bg-no-repeat relative"
      style={{
        backgroundImage: `url(${company.loginBackgroundUrl})`,
        backgroundColor: company.primaryColor,
      }}
    >
      {/* Floating login card */}
      <div className="min-h-screen flex items-center px-4 sm:px-8 lg:px-24">
        <div className="w-full max-w-[420px] bg-white rounded-2xl shadow-2xl p-8 sm:p-10 my-8">
          {/* Company logo — always dark/black */}
          <div className="flex items-center justify-center mb-8">
            {company.logoUrl ? (
              <img
                src={company.logoUrl}
                alt={company.name}
                className="h-10 max-w-[180px] object-contain brightness-0"
              />
            ) : (
              <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
            )}
          </div>

          {/* Welcome text */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-semibold text-slate-900">Velkomin</h2>
            <p className="text-sm text-slate-500 mt-2">Skráðu þig inn á Snið</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <Label htmlFor="email">Netfang</Label>
              <Input id="email" type="email" placeholder="admin@fyrirtæki.is" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1.5 h-12" />
            </div>
            <div>
              <Label htmlFor="password">Lykilorð</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1.5 h-12" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-base font-medium"
              style={{ backgroundColor: company.primaryColor }}
            >
              {loading ? "Skrái inn..." : "Skrá inn"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
