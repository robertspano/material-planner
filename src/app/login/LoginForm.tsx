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
  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left: Form panel */}
      <div className="flex flex-col justify-center items-center p-8 lg:w-[480px] lg:min-w-[480px] bg-white">
        <div className="w-full max-w-sm">
          {/* Company logo */}
          <div className="flex items-center justify-center mb-10">
            {company.logoUrl ? (
              <img src={company.logoUrl} alt={company.name} className="h-12 max-w-[240px] object-contain" />
            ) : (
              <h1 className="text-2xl font-bold text-slate-900">{company.name}</h1>
            )}
          </div>

          {/* Welcome text */}
          <div className="text-center mb-8">
            <h2 className="text-xl font-semibold text-slate-900">Velkomin</h2>
            <p className="text-sm text-slate-500 mt-1">Skráðu þig inn á stjórnborð</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Netfang</Label>
              <Input id="email" type="email" placeholder="admin@fyrirtæki.is" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1 h-11" />
            </div>
            <div>
              <Label htmlFor="password">Lykilorð</Label>
              <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 h-11" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-base"
              style={{ backgroundColor: company.primaryColor }}
            >
              {loading ? "Skrái inn..." : "Skrá inn"}
            </Button>
          </form>
        </div>
      </div>

      {/* Right: Background image (desktop only) */}
      <div
        className="hidden lg:block flex-1 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${company.loginBackgroundUrl})`,
          backgroundColor: company.primaryColor,
        }}
      />

      {/* Mobile: show a small strip of the background */}
      <div
        className="lg:hidden h-32 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(${company.loginBackgroundUrl})`,
          backgroundColor: company.primaryColor,
        }}
      />
    </div>
  );
}
