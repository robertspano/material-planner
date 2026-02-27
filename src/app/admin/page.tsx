"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Package, ImageIcon, Layers, ExternalLink, Settings, Upload, Loader2, X, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryClient } from "@/lib/queryClient";
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="max-w-6xl space-y-10">
      {/* Overview section */}
      <div className="space-y-5">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: brandColor + "15", color: brandColor }}
            >
              <Settings className="w-3.5 h-3.5" />
              Stillingar
            </button>
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
        </div>

        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Package} color="blue" value={stats?.totalProducts} label="Vörur" />
          <StatCard icon={Layers} color="emerald" value={stats?.generationsUsed} label="Generates" />
          <StatCard icon={ImageIcon} color="orange" value={stats?.totalGenerations} label="Myndir" />
        </div>
      </div>

      {/* Products section */}
      <ProductsPage brandColor={brandColor} />

      {/* Settings popup */}
      {settingsOpen && (
        <SettingsModal
          company={company}
          brandColor={brandColor}
          companySlug={companySlug}
          adminApiUrl={adminApiUrl}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Settings Modal ── */
function SettingsModal({
  company,
  brandColor,
  companySlug,
  adminApiUrl,
  onClose,
}: {
  company: CompanyBranding | undefined;
  brandColor: string;
  companySlug: string;
  adminApiUrl: (path: string) => string;
  onClose: () => void;
}) {
  const brandingKey = `/api/planner/company?company=${companySlug}`;
  const companyUrl = adminApiUrl("/api/planner/company");

  const [primary, setPrimary] = useState(company?.primaryColor || "");
  const [secondary, setSecondary] = useState(company?.secondaryColor || "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const currentLogoUrl = logoPreview || company?.logoUrl;

  const handleLogoSelect = (file: File | null) => {
    setLogoFile(file);
    if (file) {
      setLogoPreview(URL.createObjectURL(file));
    } else {
      setLogoPreview(null);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (primary !== company?.primaryColor) fd.append("primaryColor", primary);
      if (secondary !== company?.secondaryColor) fd.append("secondaryColor", secondary);
      if (logoFile) fd.append("logo", logoFile);

      const res = await fetch(adminApiUrl("/api/admin/settings"), {
        method: "PATCH",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [brandingKey] });
      queryClient.invalidateQueries({ queryKey: [companyUrl] });
      setLogoFile(null);
      setLogoPreview(null);
      onClose();
    },
  });

  const hasChanges =
    primary !== (company?.primaryColor || "") ||
    secondary !== (company?.secondaryColor || "") ||
    logoFile !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-900">Stillingar</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400 hover:text-slate-600" /></button>
        </div>

        <div className="space-y-5">
          {/* Company name + kennitala */}
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Fyrirtæki</Label>
            {company?.name ? (
              <div className="mt-1">
                <p className="text-base font-bold text-slate-900">{company.name}</p>
                {company.kennitala && (
                  <p className="text-sm text-slate-500 font-mono mt-0.5">kt. {company.kennitala}</p>
                )}
              </div>
            ) : (
              <div className="h-6 w-40 bg-slate-100 rounded animate-pulse mt-1" />
            )}
          </div>

          {/* Logo */}
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Lógó</Label>
            <div className="mt-3 flex items-center gap-4">
              <div
                className="w-24 h-14 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
                style={{ backgroundColor: primary || brandColor }}
              >
                {currentLogoUrl ? (
                  <img src={currentLogoUrl} alt="Logo" className="h-8 w-auto max-w-[80px] object-contain brightness-0 invert" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-white/50" />
                )}
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <Upload className="w-3 h-3" />
                    {currentLogoUrl ? "Skipta um" : "Hlaða upp"}
                  </button>
                  {logoFile && (
                    <button onClick={() => handleLogoSelect(null)} className="h-8 px-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {logoFile ? (
                  <p className="text-[11px] text-emerald-500 font-medium">{logoFile.name}</p>
                ) : (
                  <p className="text-[10px] text-slate-400">PNG, SVG eða JPG</p>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => handleLogoSelect(e.target.files?.[0] || null)}
              />
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Aðallitur</Label>
              <div className="flex gap-2 mt-1.5">
                <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="font-mono text-xs flex-1 h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-slate-400 uppercase tracking-wider">Aukalitur</Label>
              <div className="flex gap-2 mt-1.5">
                <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5" />
                <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} className="font-mono text-xs flex-1 h-9" />
              </div>
            </div>
          </div>

          {/* Save */}
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!hasChanges || saveMutation.isPending}
            className="w-full text-white hover:opacity-90 h-9"
            style={{ backgroundColor: primary || brandColor }}
          >
            {saveMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Vista...</>
            ) : (
              <><Save className="w-4 h-4 mr-1.5" /> Vista breytingar</>
            )}
          </Button>
        </div>
      </div>
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
