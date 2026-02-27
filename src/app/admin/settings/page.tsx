"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paintbrush, Upload, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAdminCompany } from "@/components/admin/admin-company-context";
import type { CompanyBranding } from "@/types";

export default function SettingsPage() {
  const { adminApiUrl } = useAdminCompany();
  const companyUrl = adminApiUrl("/api/planner/company");
  const { data: company, isLoading } = useQuery<CompanyBranding>({ queryKey: [companyUrl] });

  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (company && !initialized) {
    setPrimary(company.primaryColor);
    setSecondary(company.secondaryColor);
    setInitialized(true);
  }

  const updateMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/super/companies/${company?.id}`, { primaryColor: primary, secondaryColor: secondary }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [companyUrl] }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin dark:text-slate-400" /></div>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl lg:text-2xl font-bold dark:text-white text-slate-900">Stillingar</h1>

      <div className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-6">
        <h2 className="text-lg font-semibold dark:text-white text-slate-900 mb-4 flex items-center gap-2">
          <Paintbrush className="w-5 h-5" style={{ color: primary || "#2e7cff" }} /> Útlit og vörumerki
        </h2>

        <div className="space-y-4">
          <div>
            <Label>Nafn fyrirtækis</Label>
            <p className="text-lg font-bold dark:text-white text-slate-900 mt-1">{company?.name}</p>
          </div>

          <div>
            <Label>Lógó</Label>
            <div className="mt-2 flex items-center gap-4">
              {company?.logoUrl ? (
                <img src={company.logoUrl} alt="Logo" className="h-12 w-auto rounded" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <Upload className="w-5 h-5 dark:text-slate-400" />
                </div>
              )}
              <p className="text-xs dark:text-slate-400 text-slate-500">Hafðu samband við kerfisstjóra til að breyta lógói</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Aðallitur</Label>
              <div className="flex gap-2 mt-1">
                <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="w-10 h-10 rounded border cursor-pointer" />
                <Input value={primary} onChange={(e) => setPrimary(e.target.value)} className="font-mono text-sm flex-1" />
              </div>
            </div>
            <div>
              <Label>Aukalitur</Label>
              <div className="flex gap-2 mt-1">
                <input type="color" value={secondary} onChange={(e) => setSecondary(e.target.value)} className="w-10 h-10 rounded border cursor-pointer" />
                <Input value={secondary} onChange={(e) => setSecondary(e.target.value)} className="font-mono text-sm flex-1" />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div>
            <Label>Forskoðun</Label>
            <div className="mt-2 rounded-xl border dark:border-slate-700 border-slate-200 p-4" style={{ borderLeftWidth: 4, borderLeftColor: primary }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: primary }}>
                  <Paintbrush className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold" style={{ color: primary }}>{company?.name}</span>
              </div>
              <div className="flex gap-2">
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: primary }}>Aðaltakki</button>
                <button className="px-4 py-2 rounded-lg text-white text-sm font-medium" style={{ backgroundColor: secondary }}>Aukatakki</button>
              </div>
            </div>
          </div>

          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="text-white hover:opacity-90"
            style={{ backgroundColor: primary || "#2e7cff" }}
          >
            {updateMutation.isPending ? "Vista..." : "Vista breytingar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
