"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Palette, Upload, Loader2, ImageIcon, X, Save } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyBranding } from "@/types";

export default function SettingsPage() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const companyUrl = adminApiUrl("/api/planner/company");
  const brandingKey = `/api/planner/company?company=${companySlug}`;
  const { data: company, isLoading } = useQuery<CompanyBranding>({ queryKey: [brandingKey] });

  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  if (company && !initialized) {
    setPrimary(company.primaryColor);
    setSecondary(company.secondaryColor);
    setInitialized(true);
  }

  const brandColor = primary || company?.primaryColor || "#2e7cff";
  const currentLogoUrl = logoPreview || company?.logoUrl;

  const handleLogoSelect = (file: File | null) => {
    setLogoFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
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
    },
  });

  const hasChanges =
    primary !== (company?.primaryColor || "") ||
    secondary !== (company?.secondaryColor || "") ||
    logoFile !== null;

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-lg font-semibold text-slate-900">Stillingar</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        {/* Company name + kennitala */}
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">Fyrirtæki</Label>
          {company?.name ? (
            <div className="mt-1">
              <p className="text-lg font-bold text-slate-900">{company.name}</p>
              {company.kennitala && (
                <p className="text-sm text-slate-500 font-mono mt-0.5">kt. {company.kennitala}</p>
              )}
            </div>
          ) : (
            <div className="h-7 w-40 bg-slate-100 rounded animate-pulse mt-1" />
          )}
        </div>

        {/* Logo */}
        <div>
          <Label className="text-xs text-slate-400 uppercase tracking-wider">Lógó</Label>
          <div className="mt-3 flex items-center gap-5">
            {/* Logo preview with brand color background */}
            <div
              className="w-28 h-16 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
              style={{ backgroundColor: brandColor }}
            >
              {currentLogoUrl ? (
                <img
                  src={currentLogoUrl}
                  alt="Logo"
                  className="h-10 w-auto max-w-[100px] object-contain brightness-0 invert"
                />
              ) : (
                <ImageIcon className="w-6 h-6 text-white/50" />
              )}
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => logoInputRef.current?.click()}
                  className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-sm font-medium border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {currentLogoUrl ? "Skipta um" : "Hlaða upp"}
                </button>
                {logoFile && (
                  <button
                    onClick={() => handleLogoSelect(null)}
                    className="h-9 px-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {logoFile ? (
                <p className="text-xs text-emerald-500 font-medium">{logoFile.name}</p>
              ) : (
                <p className="text-[11px] text-slate-400">PNG, SVG eða JPG (hámark 5MB)</p>
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
        <div className="grid grid-cols-2 gap-5">
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Aðallitur</Label>
            <div className="flex gap-2 mt-2">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5"
              />
              <Input
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="font-mono text-sm flex-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wider">Aukalitur</Label>
            <div className="flex gap-2 mt-2">
              <input
                type="color"
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer p-0.5"
              />
              <Input
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
                className="font-mono text-sm flex-1"
              />
            </div>
          </div>
        </div>

        {/* Save button */}
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!hasChanges || saveMutation.isPending}
          className="w-full text-white hover:opacity-90 h-10"
          style={{ backgroundColor: brandColor }}
        >
          {saveMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Vista...</>
          ) : (
            <><Save className="w-4 h-4 mr-1.5" /> Vista breytingar</>
          )}
        </Button>
      </div>
    </div>
  );
}
