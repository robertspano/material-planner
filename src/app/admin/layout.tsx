"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { LogOut, Settings, FileText, ExternalLink, X, Upload, Save, Loader2, ImageIcon, Eye, Calendar, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCompanyProvider, useAdminCompany } from "@/components/admin/admin-company-context";
import { queryClient } from "@/lib/queryClient";
import type { CompanyBranding } from "@/types";

/* ── Tilboð types ── */
interface QuoteGeneration {
  id: string;
  sessionId: string;
  roomImageUrl: string;
  roomWidth: number | null;
  roomLength: number | null;
  roomHeight: number | null;
  floorArea: number | null;
  wallArea: number | null;
  createdAt: string;
  products: {
    id: string;
    surfaceType: string;
    product: {
      id: string;
      name: string;
      price: number | null;
      unit: string;
      imageUrl: string;
      discountPercent: number | null;
      tileWidth: number | null;
      tileHeight: number | null;
    };
  }[];
  results: {
    imageUrl: string;
    surfaceType: string;
  }[];
}

function AdminLayoutInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { companySlug, isSuperAdmin, admin, isLoading: authLoading, adminApiUrl } = useAdminCompany();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tilbodOpen, setTilbodOpen] = useState(false);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !admin) {
      router.replace("/login");
    }
  }, [authLoading, admin, router]);

  // Prefetch combined dashboard (one cold start instead of 4 separate API calls)
  useEffect(() => {
    if (admin && companySlug) {
      queryClient.prefetchQuery({ queryKey: [`/api/planner/company?company=${companySlug}`] });
      queryClient.prefetchQuery({ queryKey: [adminApiUrl("/api/admin/dashboard")] });
    }
  }, [admin, companySlug, adminApiUrl]);

  const { data: company } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const brandColor = company?.primaryColor || "#2e7cff";
  const showContent = !authLoading && !!admin;

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ '--primary': brandColor, '--ring': brandColor } as React.CSSProperties}
    >
      {/* Top bar — logo | nav buttons | logout */}
      <div className="flex items-center justify-between px-4 lg:px-8 pt-4 lg:pt-6">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          {company?.logoUrl ? (
            <div
              className="h-10 px-5 rounded-xl flex items-center"
              style={{ backgroundColor: brandColor }}
            >
              <img
                src={company.logoUrl}
                alt={company.name}
                className="h-6 w-auto max-w-[140px] object-contain brightness-0 invert"
              />
            </div>
          ) : company?.name ? (
            <div
              className="h-10 px-5 rounded-xl flex items-center"
              style={{ backgroundColor: brandColor }}
            >
              <span className="font-bold text-white text-sm">{company.name}</span>
            </div>
          ) : (
            <div className="h-10 w-32 bg-slate-200 rounded-xl animate-pulse" />
          )}
          {isSuperAdmin && (
            <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">SA</span>
          )}
        </div>

        {/* Center: Navigation buttons */}
        {showContent && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: brandColor + "15", color: brandColor }}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Stillingar</span>
            </button>
            <button
              onClick={() => setTilbodOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ backgroundColor: brandColor + "15", color: brandColor }}
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tilboð</span>
            </button>
            <a
              href={`/?company=${companySlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: brandColor }}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Planner</span>
            </a>
          </div>
        )}

        {/* Right: Admin + Logout */}
        <div className="flex items-center gap-2">
          {admin && (
            <span className="text-xs text-slate-400 hidden sm:block">{admin.name}</span>
          )}
          <button
            onClick={handleLogout}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Útskrá"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content — centered */}
      <main className="max-w-6xl mx-auto px-4 lg:px-8 py-6">
        {showContent ? children : null}
      </main>

      {/* Settings Modal */}
      {settingsOpen && (
        <SettingsModal
          company={company}
          brandColor={brandColor}
          companySlug={companySlug}
          adminApiUrl={adminApiUrl}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Tilboð Modal */}
      {tilbodOpen && (
        <TilbodModal
          brandColor={brandColor}
          adminApiUrl={adminApiUrl}
          onClose={() => setTilbodOpen(false)}
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

/* ── Tilboð Modal ── */
function TilbodModal({
  brandColor,
  adminApiUrl,
  onClose,
}: {
  brandColor: string;
  adminApiUrl: (path: string) => string;
  onClose: () => void;
}) {
  const quotesUrl = adminApiUrl("/api/admin/quotes");
  const { data: generations = [], isLoading } = useQuery<QuoteGeneration[]>({
    queryKey: [quotesUrl],
  });

  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("is-IS", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Tilboð</h2>
            <p className="text-xs text-slate-400 mt-0.5">PDF skjöl frá viðskiptavinum</p>
          </div>
          <button onClick={onClose}>
            <X className="w-5 h-5 text-slate-400 hover:text-slate-600" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-4 animate-pulse">
                  <div className="flex gap-4">
                    <div className="w-20 h-20 bg-slate-200 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-200 rounded w-2/3" />
                      <div className="h-3 bg-slate-200 rounded w-1/3" />
                      <div className="h-3 bg-slate-200 rounded w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : generations.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Engin tilboð fundust</p>
            </div>
          ) : (
            <div className="space-y-3">
              {generations.map((gen) => (
                <div
                  key={gen.id}
                  className="bg-slate-50 rounded-xl p-4 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex gap-4">
                    {/* Thumbnail — result image or room image */}
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-slate-200 flex-shrink-0">
                      {gen.results[0]?.imageUrl ? (
                        <img
                          src={gen.results[0].imageUrl}
                          alt="Niðurstaða"
                          className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setSelectedImage(gen.results[0].imageUrl)}
                        />
                      ) : gen.roomImageUrl ? (
                        <img
                          src={gen.roomImageUrl}
                          alt="Herbergi"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="w-6 h-6 text-slate-300" />
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      {/* Products */}
                      <div className="flex flex-wrap gap-1.5">
                        {gen.products.map((gp) => (
                          <span
                            key={gp.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium"
                            style={{ backgroundColor: brandColor + "15", color: brandColor }}
                          >
                            {gp.product.name}
                            {gp.product.price && (
                              <span className="opacity-60">
                                {gp.product.discountPercent
                                  ? Math.round(gp.product.price * (1 - gp.product.discountPercent / 100)).toLocaleString("is-IS")
                                  : gp.product.price.toLocaleString("is-IS")}{" "}
                                kr/{gp.product.unit === "m2" ? "m²" : "stk"}
                              </span>
                            )}
                          </span>
                        ))}
                      </div>

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(gen.createdAt)}
                        </span>
                        {(gen.roomWidth && gen.roomLength) && (
                          <span className="flex items-center gap-1">
                            <Ruler className="w-3 h-3" />
                            {gen.roomWidth.toFixed(1)} × {gen.roomLength.toFixed(1)} m
                            {gen.floorArea && (
                              <span className="text-slate-300 ml-0.5">({gen.floorArea.toFixed(1)} m²)</span>
                            )}
                          </span>
                        )}
                        {gen.results.length > 1 && (
                          <span className="flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            {gen.results.length} myndir
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Result thumbnails (extra images) */}
                    {gen.results.length > 1 && (
                      <div className="hidden md:flex gap-1.5 flex-shrink-0">
                        {gen.results.slice(1, 3).map((r, i) => (
                          <div
                            key={i}
                            className="w-14 h-14 rounded-lg overflow-hidden bg-slate-200 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={() => setSelectedImage(r.imageUrl)}
                          >
                            <img
                              src={r.imageUrl}
                              alt={`Niðurstaða ${i + 2}`}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Image lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-8"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            alt="Stækkuð mynd"
            className="max-w-full max-h-full rounded-xl shadow-2xl"
          />
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
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
