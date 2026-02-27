"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Settings2, Copy, CheckCircle2, Layers, ChevronLeft, ChevronRight, Pencil, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
// Theme is controlled by company branding
import { RoomUpload } from "@/components/planner/room-upload";
import type { RoomEntry } from "@/components/planner/room-upload";
import type { SurfaceSelection } from "@/components/planner/surface-selector";
import { ProductCarousel } from "@/components/planner/product-carousel";
import { TilingPatternSelector, ensureValidPattern, getDefaultPattern } from "@/components/planner/tiling-pattern";
import type { TilingPattern } from "@/components/planner/tiling-pattern";
import { MultiResultGallery } from "@/components/planner/multi-result-gallery";
import type { GenerationGroup } from "@/components/planner/multi-result-gallery";
import type { CompanyBranding } from "@/types";

type Step = "upload" | "configure" | "result";

interface SelectedProduct {
  id: string;
  name: string;
  price: number | null;
  unit: string;
  imageUrl: string;
  swatchUrl: string | null;
  description: string | null;
  tileWidth: number | null;
  tileHeight: number | null;
  discountPercent: number | null;
  category: { name: string };
}

interface ImageConfig {
  entry: RoomEntry;
  surfaces: SurfaceSelection | null;
  floorProduct: SelectedProduct | null;
  wallProduct: SelectedProduct | null;
  floorPattern: TilingPattern;
  wallPattern: TilingPattern;
}

function getCompanySlug(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const fromParam = params.get("company");
  if (fromParam) return fromParam;
  const hostname = window.location.hostname;
  // Skip subdomain extraction for Vercel domains
  if (hostname.includes("vercel.app") || hostname.includes("vercel.sh")) return "demo";
  // Production: alfaborg.snid.is → "alfaborg"
  const parts = hostname.split(".");
  if (parts.length >= 3) return parts[0];
  // Root domain (snid.is) without subdomain — landing page handles this
  return "";
}

// Read cached company from localStorage (instant, no flash)
function getCachedCompany(slug: string): CompanyBranding | undefined {
  if (typeof window === "undefined" || !slug) return undefined;
  try {
    const raw = localStorage.getItem(`company_${slug}`);
    if (raw) return JSON.parse(raw) as CompanyBranding;
  } catch { /* ignore */ }
  return undefined;
}

export default function PlannerPage() {
  const [companySlug, setCompanySlug] = useState("");

  useEffect(() => {
    setCompanySlug(getCompanySlug());
  }, []);

  const cachedCompany = useMemo(() => getCachedCompany(companySlug), [companySlug]);

  const { data: company, isError: companyError } = useQuery<CompanyBranding>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
    placeholderData: cachedCompany,
    staleTime: 0,
    retry: 1,
  });

  // Cache company data for instant reload
  useEffect(() => {
    if (company && companySlug) {
      localStorage.setItem(`company_${companySlug}`, JSON.stringify(company));
      document.documentElement.style.setProperty("--brand-primary", company.primaryColor);
      document.documentElement.style.setProperty("--brand-secondary", company.secondaryColor);
    }
  }, [company, companySlug]);

  // --- State ---
  const [step, setStep] = useState<Step>("upload");
  const [imageConfigs, setImageConfigs] = useState<ImageConfig[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [applyToAll, setApplyToAll] = useState(true);
  const [generationGroups, setGenerationGroups] = useState<GenerationGroup[]>([]);
  const [generating, setGenerating] = useState(false);
  const [surfaceTab, setSurfaceTab] = useState<"floor" | "wall">("floor");
  const [browsingSurface, setBrowsingSurface] = useState<"floor" | "wall" | null>(null);

  const activeConfig = imageConfigs[activeImageIdx] || null;

  const patternLabels: Record<TilingPattern, string> = {
    straight: "Bein lögn",
    brick: "Múrsteinslögn",
    herringbone: "Síldargrátslögn",
    diagonal: "Á ská (45°)",
    chevron: "Chevron",
    stacked: "Upprétt lögn",
    "one-third": "Þriðjungslögn",
  };

  // --- Helpers ---
  const updateConfig = (idx: number, updates: Partial<ImageConfig>) => {
    setImageConfigs(prev => prev.map((cfg, i) => {
      if (applyToAll || i === idx) {
        const newCfg = { ...cfg, ...updates };
        // Clear products when surface changes
        if (updates.surfaces !== undefined) {
          if (updates.surfaces === "floor") newCfg.wallProduct = null;
          if (updates.surfaces === "wall") newCfg.floorProduct = null;
        }
        // Auto-set valid pattern when product changes
        if (updates.floorProduct) {
          newCfg.floorPattern = ensureValidPattern(
            newCfg.floorPattern,
            updates.floorProduct.category.name,
            updates.floorProduct.name,
            updates.floorProduct.description ?? undefined
          );
        }
        if (updates.wallProduct) {
          newCfg.wallPattern = ensureValidPattern(
            newCfg.wallPattern,
            updates.wallProduct.category.name,
            updates.wallProduct.name,
            updates.wallProduct.description ?? undefined
          );
        }
        return newCfg;
      }
      return cfg;
    }));
  };

  const updateActiveConfig = (updates: Partial<ImageConfig>) => {
    updateConfig(activeImageIdx, updates);
  };

  // --- Handlers ---
  const handleUpload = (entries: RoomEntry[]) => {
    const configs: ImageConfig[] = entries.map(entry => ({
      entry,
      surfaces: null,
      floorProduct: null,
      wallProduct: null,
      floorPattern: "straight",
      wallPattern: "straight",
    }));
    setImageConfigs(configs);
    setActiveImageIdx(0);
    setStep("configure");
  };

  // Compute all generation combinations from all image configs
  // "both" = ONE image with both floor + wall changed (not two separate images)
  interface Combination {
    entry: RoomEntry;
    surfaceType: "floor" | "wall" | "both";
    product: SelectedProduct;
    pattern: TilingPattern;
    wallProduct?: SelectedProduct;
    wallPattern?: TilingPattern;
  }

  const combinations = useMemo((): Combination[] => {
    return imageConfigs.flatMap((cfg): Combination[] => {
      if (!cfg.surfaces) return [];
      if (cfg.surfaces === "both") {
        // Single entry — one image with both surfaces changed
        if (!cfg.floorProduct || !cfg.wallProduct) return [];
        return [{
          entry: cfg.entry,
          surfaceType: "both",
          product: cfg.floorProduct,
          pattern: cfg.floorPattern,
          wallProduct: cfg.wallProduct,
          wallPattern: cfg.wallPattern,
        }];
      }
      // Single surface — floor or wall
      const product = cfg.surfaces === "floor" ? cfg.floorProduct : cfg.wallProduct;
      if (!product) return [];
      return [{
        entry: cfg.entry,
        surfaceType: cfg.surfaces,
        product,
        pattern: cfg.surfaces === "floor" ? cfg.floorPattern : cfg.wallPattern,
      }];
    });
  }, [imageConfigs]);

  // Check if all images are fully configured
  const allConfigured = imageConfigs.length > 0 && imageConfigs.every(cfg => {
    if (!cfg.surfaces) return false;
    if ((cfg.surfaces === "floor" || cfg.surfaces === "both") && !cfg.floorProduct) return false;
    if ((cfg.surfaces === "wall" || cfg.surfaces === "both") && !cfg.wallProduct) return false;
    return true;
  });

  // Check how many are configured (for progress)
  const configuredCount = imageConfigs.filter(cfg => {
    if (!cfg.surfaces) return false;
    if ((cfg.surfaces === "floor" || cfg.surfaces === "both") && !cfg.floorProduct) return false;
    if ((cfg.surfaces === "wall" || cfg.surfaces === "both") && !cfg.wallProduct) return false;
    return true;
  }).length;

  const handleGenerate = async () => {
    if (combinations.length === 0) return;
    setGenerating(true);
    try {
      // Create a unique batchId to group all generations from this button press
      const batchId = crypto.randomUUID();

      // Send API calls with short stagger (500ms) to register them all quickly,
      // the actual Gemini work runs async on the server with its own retry logic
      const results: { generationId: string; status: string }[] = [];
      for (let i = 0; i < combinations.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 500));
        const combo = combinations[i];
        const res = await fetch(`/api/planner/generate?company=${companySlug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generationId: combo.entry.generationId,
            surfaceType: combo.surfaceType,
            productId: combo.product.id,
            pattern: combo.pattern,
            batchId,
            // "both" mode: include wall product info
            ...(combo.surfaceType === "both" && combo.wallProduct ? {
              wallProductId: combo.wallProduct.id,
              wallPattern: combo.wallPattern,
            } : {}),
          }),
        });
        results.push(await res.json());
      }

      const groups: GenerationGroup[] = combinations.map((combo, i) => ({
        roomImageUrl: combo.entry.imageUrl,
        generationId: results[i]?.generationId || combo.entry.generationId,
        surfaceType: combo.surfaceType,
        product: combo.product,
        ...(combo.wallProduct ? { wallProduct: combo.wallProduct } : {}),
      }));

      setGenerationGroups(groups);
      setStep("result");
    } catch (err) {
      console.error("Generate error:", err);
    } finally {
      setGenerating(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setImageConfigs([]);
    setActiveImageIdx(0);
    setApplyToAll(true);
    setGenerationGroups([]);
  };

  const brandColor = company?.primaryColor || "#2e7cff";

  // Step indicator
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Myndir" },
    { key: "configure", label: "Stilla" },
    { key: "result", label: "Niðurstaða" },
  ];

  const stepOrder: Step[] = ["upload", "configure", "result"];
  const currentIdx = stepOrder.indexOf(step);

  // Surface options
  const surfaceOptions: { value: SurfaceSelection; label: string }[] = [
    { value: "floor", label: "Gólf" },
    { value: "wall", label: "Veggir" },
    { value: "both", label: "Bæði" },
  ];

  // Company deactivated or not found — clear cache and show lock screen
  if (companyError) {
    if (typeof window !== "undefined" && companySlug) {
      localStorage.removeItem(`company_${companySlug}`);
    }
    return (
      <div className="min-h-screen bg-[#eeeeee] relative flex items-center justify-center">
        <div className="absolute inset-0 backdrop-blur-md bg-white/60" />
        <div className="relative z-10 flex flex-col items-center gap-4 text-center px-6">
          <div className="w-20 h-20 rounded-full bg-slate-200 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-700">Þjónusta ekki virk</h1>
          <p className="text-sm text-slate-500 max-w-xs">Þessi sjónræna sýn er ekki virk eins og er. Hafðu samband við þjónustuaðila fyrir frekari upplýsingar.</p>
        </div>
      </div>
    );
  }

  // First visit only (no cache yet): show minimal loading
  if (!company) {
    return <div className="min-h-screen bg-[#eeeeee]" />;
  }

  return (
    <div className="min-h-screen bg-[#eeeeee]">
      {/* Header */}
      <header className="sticky top-0 z-30 shadow-md" style={{ backgroundColor: brandColor }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center">
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-8 w-auto" />
          ) : (
            <span className="text-white font-bold text-lg tracking-wide uppercase">{company.name}</span>
          )}
        </div>
      </header>

      {/* Step Progress — sticky below header */}
      <div className="sticky top-14 z-20 bg-[#eeeeee] border-b border-slate-200/60 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center gap-0">
            {steps.map((s, i) => {
              const done = i < currentIdx;
              const active = i === currentIdx;
              return (
                <div key={s.key} className="flex items-center flex-1 last:flex-initial">
                  <button
                    onClick={() => { if (done) setStep(s.key); }}
                    disabled={!done}
                    className="flex items-center gap-2 group"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        active
                          ? "text-white shadow-lg scale-110"
                          : done
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-300 text-white"
                      }`}
                      style={active ? { backgroundColor: brandColor } : undefined}
                    >
                      {done ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </div>
                    <span className={`text-sm font-medium hidden sm:block ${
                      active ? "text-slate-900" : done ? "text-emerald-600 group-hover:text-emerald-700" : "text-slate-400"
                    }`}>
                      {s.label}
                    </span>
                  </button>
                  {i < steps.length - 1 && (
                    <div className="flex-1 mx-3 h-0.5 rounded-full"
                      style={{ backgroundColor: done ? '#10b981' : '#d1d5db' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-4 pt-8 pb-12">
          <div className="space-y-6">
            {/* STEP: Upload */}
            {step === "upload" && (
              <>
                <div className="text-center mb-8">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 mb-3 tracking-tight leading-tight">
                    Sjáðu efnin í <span style={{ color: brandColor }}>þínu rými</span>
                  </h1>
                  <p className="text-slate-500 text-base max-w-md mx-auto">
                    Taktu mynd eða hladdu upp og sjáðu flísar, parket og efni í herberginu
                  </p>
                </div>
                <RoomUpload onUploaded={handleUpload} companySlug={companySlug} />
              </>
            )}

            {/* STEP: Configure */}
            {step === "configure" && imageConfigs.length > 0 && (
              <div className="space-y-5">
                {/* Active image preview with arrows */}
                {activeConfig && (
                  <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm bg-white group aspect-[16/9]">
                    <img
                      src={activeConfig.entry.localPreviewUrl || activeConfig.entry.imageUrl}
                      alt="Herbergi"
                      className="w-full h-full object-cover"
                    />
                    {/* Image counter */}
                    {imageConfigs.length > 1 && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-black/50 text-white text-xs font-semibold z-10">
                        {activeImageIdx + 1} / {imageConfigs.length}
                      </div>
                    )}
                    {/* Left arrow — always visible on mobile, hover on desktop */}
                    {imageConfigs.length > 1 && (
                      <button
                        onClick={() => setActiveImageIdx(prev => prev <= 0 ? imageConfigs.length - 1 : prev - 1)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 z-10"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    )}
                    {/* Right arrow — always visible on mobile, hover on desktop */}
                    {imageConfigs.length > 1 && (
                      <button
                        onClick={() => setActiveImageIdx(prev => prev >= imageConfigs.length - 1 ? 0 : prev + 1)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100 z-10"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Image thumbnails strip — below the main image */}
                {imageConfigs.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {imageConfigs.map((cfg, i) => {
                      const isActive = i === activeImageIdx;
                      const isConfigured = cfg.surfaces && (
                        (cfg.surfaces === "floor" && cfg.floorProduct) ||
                        (cfg.surfaces === "wall" && cfg.wallProduct) ||
                        (cfg.surfaces === "both" && cfg.floorProduct && cfg.wallProduct)
                      );
                      return (
                        <button
                          key={i}
                          onClick={() => setActiveImageIdx(i)}
                          className={`relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-all ${
                            isActive
                              ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30 shadow-lg"
                              : isConfigured
                              ? "border-emerald-400"
                              : "border-slate-200 hover:border-slate-400"
                          }`}
                        >
                          <img src={cfg.entry.localPreviewUrl || cfg.entry.imageUrl} alt={`Mynd ${i + 1}`} className="w-full h-full object-cover" />
                          {/* Green overlay + checkmark for configured images */}
                          {isConfigured && (
                            <div className="absolute inset-0 bg-emerald-500/25 flex items-center justify-center">
                              <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center shadow-md">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Mode toggle — Sama/Sérsníða — below thumbnails */}
                {imageConfigs.length > 1 && (
                  <div className="relative flex bg-white rounded-2xl p-1.5 shadow-sm border border-slate-200">
                    {/* Sliding pill */}
                    <div
                      className="absolute top-1.5 bottom-1.5 rounded-xl transition-all duration-300 ease-out shadow-sm"
                      style={{
                        width: "calc(50% - 6px)",
                        left: applyToAll ? "6px" : "calc(50% + 0px)",
                        backgroundColor: brandColor,
                      }}
                    />
                    {(
                      [
                        { key: true, icon: <Copy className="w-4 h-4" />, label: "Sama fyrir allar" },
                        { key: false, icon: <Settings2 className="w-4 h-4" />, label: "Sérsníða hverja" },
                      ] as const
                    ).map(({ key, icon, label }) => {
                      const isActive = applyToAll === key;
                      return (
                        <button
                          key={String(key)}
                          onClick={() => {
                            if (key === true && !applyToAll && activeConfig) {
                              setImageConfigs(prev => prev.map(cfg => ({
                                ...cfg,
                                surfaces: activeConfig.surfaces,
                                floorProduct: activeConfig.floorProduct,
                                wallProduct: activeConfig.wallProduct,
                                floorPattern: activeConfig.floorPattern,
                                wallPattern: activeConfig.wallPattern,
                              })));
                            }
                            setApplyToAll(key);
                          }}
                          className={`relative z-10 flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-colors duration-200 ${
                            isActive ? "text-white" : "text-slate-400 hover:text-slate-600"
                          }`}
                        >
                          {icon}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* ═══════════════════════════════════════════ */}
                {/* Surface selector — visual room cards      */}
                {/* ═══════════════════════════════════════════ */}
                {activeConfig && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-500 mb-3 uppercase tracking-wider">
                      {!applyToAll && imageConfigs.length > 1
                        ? `Mynd ${activeImageIdx + 1} — Veldu yfirborð`
                        : "Veldu yfirborð"
                      }
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      {([
                        {
                          value: "floor" as SurfaceSelection,
                          label: "Gólf",
                          desc: "Gólfefni",
                          icon: (active: boolean) => (
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                              {/* Room outline */}
                              <path d="M4 16L24 8L44 16V40H4V16Z" stroke={active ? "rgba(255,255,255,0.3)" : "#cbd5e1"} strokeWidth="1.5" fill="none" />
                              {/* Floor — highlighted */}
                              <path d="M4 32L24 24L44 32V40H4V32Z" fill={active ? "rgba(255,255,255,0.25)" : "#f1f5f9"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Floor lines */}
                              <line x1="14" y1="28" x2="14" y2="40" stroke={active ? "rgba(255,255,255,0.3)" : "#cbd5e1"} strokeWidth="1" />
                              <line x1="24" y1="24" x2="24" y2="40" stroke={active ? "rgba(255,255,255,0.3)" : "#cbd5e1"} strokeWidth="1" />
                              <line x1="34" y1="28" x2="34" y2="40" stroke={active ? "rgba(255,255,255,0.3)" : "#cbd5e1"} strokeWidth="1" />
                              <line x1="4" y1="36" x2="44" y2="36" stroke={active ? "rgba(255,255,255,0.2)" : "#e2e8f0"} strokeWidth="1" />
                            </svg>
                          ),
                        },
                        {
                          value: "wall" as SurfaceSelection,
                          label: "Veggir",
                          desc: "Veggjaefni",
                          icon: (active: boolean) => (
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                              {/* Left wall — highlighted */}
                              <path d="M4 16L24 8V32L4 40V16Z" fill={active ? "rgba(255,255,255,0.25)" : "#f1f5f9"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Right wall — highlighted */}
                              <path d="M44 16L24 8V32L44 40V16Z" fill={active ? "rgba(255,255,255,0.2)" : "#f8fafc"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Wall brick lines */}
                              <line x1="4" y1="24" x2="24" y2="16" stroke={active ? "rgba(255,255,255,0.25)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="4" y1="32" x2="24" y2="24" stroke={active ? "rgba(255,255,255,0.25)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="14" y1="12" x2="14" y2="40" stroke={active ? "rgba(255,255,255,0.15)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="24" y1="16" x2="44" y2="24" stroke={active ? "rgba(255,255,255,0.25)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="24" y1="24" x2="44" y2="32" stroke={active ? "rgba(255,255,255,0.25)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="34" y1="12" x2="34" y2="40" stroke={active ? "rgba(255,255,255,0.15)" : "#e2e8f0"} strokeWidth="1" />
                              {/* Floor — subtle */}
                              <path d="M4 40L24 32L44 40" stroke={active ? "rgba(255,255,255,0.15)" : "#cbd5e1"} strokeWidth="1" fill="none" />
                            </svg>
                          ),
                        },
                        {
                          value: "both" as SurfaceSelection,
                          label: "Bæði",
                          desc: "Gólf og veggir",
                          icon: (active: boolean) => (
                            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                              {/* Left wall — highlighted */}
                              <path d="M4 16L24 8V32L4 40V16Z" fill={active ? "rgba(255,255,255,0.2)" : "#f1f5f9"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Right wall — highlighted */}
                              <path d="M44 16L24 8V32L44 40V16Z" fill={active ? "rgba(255,255,255,0.15)" : "#f8fafc"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Floor — highlighted */}
                              <path d="M4 32L24 24L44 32V40H4V32Z" fill={active ? "rgba(255,255,255,0.25)" : "#f1f5f9"} stroke={active ? "rgba(255,255,255,0.5)" : "#94a3b8"} strokeWidth="1.5" />
                              {/* Wall lines */}
                              <line x1="4" y1="28" x2="24" y2="20" stroke={active ? "rgba(255,255,255,0.2)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="24" y1="20" x2="44" y2="28" stroke={active ? "rgba(255,255,255,0.2)" : "#e2e8f0"} strokeWidth="1" />
                              {/* Floor lines */}
                              <line x1="24" y1="24" x2="24" y2="40" stroke={active ? "rgba(255,255,255,0.2)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="4" y1="36" x2="44" y2="36" stroke={active ? "rgba(255,255,255,0.15)" : "#e2e8f0"} strokeWidth="1" />
                              {/* Sparkle to indicate "both" */}
                              <circle cx="24" cy="14" r="2" fill={active ? "rgba(255,255,255,0.6)" : "#cbd5e1"} />
                              <line x1="24" y1="10" x2="24" y2="18" stroke={active ? "rgba(255,255,255,0.4)" : "#e2e8f0"} strokeWidth="1" />
                              <line x1="20" y1="14" x2="28" y2="14" stroke={active ? "rgba(255,255,255,0.4)" : "#e2e8f0"} strokeWidth="1" />
                            </svg>
                          ),
                        },
                      ]).map(({ value, label, desc, icon }) => {
                        const isActive = activeConfig.surfaces === value;
                        return (
                          <button
                            key={value}
                            onClick={() => {
                              updateActiveConfig({ surfaces: value });
                              if (value === "both") setSurfaceTab("floor");
                              setBrowsingSurface(null);
                            }}
                            className={`relative flex flex-col items-center gap-2 p-4 sm:p-5 rounded-2xl border-2 transition-all duration-200 ${
                              isActive
                                ? "text-white shadow-lg border-transparent scale-[1.02]"
                                : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:shadow-sm"
                            }`}
                            style={isActive ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
                          >
                            {/* Room illustration */}
                            <div className="transition-transform duration-200 group-hover:scale-110">
                              {icon(isActive)}
                            </div>
                            {/* Label */}
                            <div className="text-center">
                              <p className={`text-sm font-bold ${isActive ? "text-white" : "text-slate-700"}`}>
                                {label}
                              </p>
                              <p className={`text-[10px] mt-0.5 ${isActive ? "text-white/70" : "text-slate-400"}`}>
                                {desc}
                              </p>
                            </div>
                            {/* Active checkmark */}
                            {isActive && (
                              <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white shadow-md flex items-center justify-center">
                                <svg className="w-3.5 h-3.5" style={{ color: brandColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* --- Surface product sections --- */}
                {activeConfig && activeConfig.surfaces && (() => {
                  const surfaceList: ("floor" | "wall")[] = activeConfig.surfaces === "both"
                    ? ["floor", "wall"]
                    : [activeConfig.surfaces as "floor" | "wall"];

                  const getProduct = (s: "floor" | "wall") => s === "floor" ? activeConfig.floorProduct : activeConfig.wallProduct;
                  const getPattern = (s: "floor" | "wall") => s === "floor" ? activeConfig.floorPattern : activeConfig.wallPattern;
                  const surfaceLabel = (s: "floor" | "wall") => s === "floor" ? "Gólfefni" : "Veggjaefni";

                  return (
                    <>
                      {surfaceList.map((surf) => {
                        const product = getProduct(surf);
                        const pattern = getPattern(surf);
                        const isBrowsing = browsingSurface === surf || (!product && surfaceList.length === 1);
                        const needsAttention = !product && !isBrowsing;

                        // Collapsed: product selected — compact card + pattern below
                        if (product && !isBrowsing) {
                          return (
                            <div key={surf} className="space-y-3">
                              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 flex-shrink-0">
                                    <img src={product.swatchUrl || product.imageUrl} alt="" className="w-full h-full object-cover" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-0.5">
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: brandColor }}>
                                        {surfaceLabel(surf)}
                                      </span>
                                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                                    </div>
                                    <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                                    <p className="text-xs text-slate-400">
                                      {product.tileWidth && product.tileHeight && `${product.tileWidth}×${product.tileHeight} cm`}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => setBrowsingSurface(surf)}
                                    className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors flex-shrink-0"
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              {/* Pattern for this surface — right below its card */}
                              <TilingPatternSelector
                                surfaceType={surf}
                                selected={pattern}
                                onSelect={(p) => {
                                  if (surf === "floor") updateActiveConfig({ floorPattern: p });
                                  else updateActiveConfig({ wallPattern: p });
                                }}
                                categoryName={product.category.name}
                                productName={product.name}
                                productDescription={product.description ?? undefined}
                              />
                              {/* AI dimension confirmation — removed, too noisy */}
                            </div>
                          );
                        }

                        // Needs attention: no product, not actively browsing
                        if (needsAttention) {
                          return (
                            <button
                              key={surf}
                              onClick={() => { setSurfaceTab(surf); setBrowsingSurface(surf); }}
                              className="w-full bg-white/60 rounded-2xl border-2 border-dashed border-slate-300 p-4 flex items-center gap-3 hover:bg-white hover:border-slate-400 transition-all"
                            >
                              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                                <Circle className="w-5 h-5 text-slate-300" />
                              </div>
                              <div className="text-left">
                                <p className="text-sm font-semibold text-slate-500">{surfaceLabel(surf)}</p>
                                <p className="text-xs text-slate-400">Smelltu til að velja efni</p>
                              </div>
                            </button>
                          );
                        }

                        // Expanded: browsing products
                        return (
                          <div key={surf} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-visible">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 rounded-t-2xl" style={{ backgroundColor: `${brandColor}06` }}>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: brandColor }}>
                                  {surfaceLabel(surf)}
                                </span>
                                <span className="text-xs text-slate-400">Veldu efni</span>
                              </div>
                              {product && (
                                <button
                                  onClick={() => setBrowsingSurface(null)}
                                  className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                                  style={{ color: brandColor }}
                                >
                                  Loka
                                </button>
                              )}
                            </div>
                            <div className="p-4">
                              <ProductCarousel
                                companySlug={companySlug}
                                surfaceType={surf}
                                selectedProductId={product?.id || null}
                                onSelect={(p) => {
                                  if (surf === "floor") updateActiveConfig({ floorProduct: p as SelectedProduct });
                                  else updateActiveConfig({ wallProduct: p as SelectedProduct });
                                  setBrowsingSurface(null);
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Generate button */}
                      {!browsingSurface && (() => {
                        // Build list of what's missing
                        const missingItems: string[] = [];
                        imageConfigs.forEach((cfg, i) => {
                          const imgLabel = imageConfigs.length > 1 ? `Mynd ${i + 1}` : "";
                          if (!cfg.surfaces) {
                            missingItems.push(`${imgLabel}${imgLabel ? ": " : ""}Veldu yfirborð (gólf/veggir/bæði)`);
                          } else {
                            if ((cfg.surfaces === "floor" || cfg.surfaces === "both") && !cfg.floorProduct) {
                              missingItems.push(`${imgLabel}${imgLabel ? ": " : ""}Veldu gólfefni`);
                            }
                            if ((cfg.surfaces === "wall" || cfg.surfaces === "both") && !cfg.wallProduct) {
                              missingItems.push(`${imgLabel}${imgLabel ? ": " : ""}Veldu veggjaefni`);
                            }
                          }
                        });
                        const isDisabled = generating || !allConfigured || combinations.length === 0;

                        return (
                          <div className="relative group/btn">
                            <Button
                              onClick={handleGenerate}
                              disabled={isDisabled}
                              className="w-full py-6 text-lg font-semibold text-white rounded-xl transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
                              style={{ backgroundColor: brandColor }}
                            >
                              {generating ? (
                                <>
                                  <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                                  Myndar...
                                </>
                              ) : (
                                <>Mynda sjónræna sýn</>
                              )}
                            </Button>
                            {/* Tooltip showing what's missing */}
                            {isDisabled && !generating && missingItems.length > 0 && (
                              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 opacity-0 group-hover/btn:opacity-100 transition-opacity duration-150 w-full max-w-sm">
                                <div className="bg-slate-900 text-white rounded-xl px-4 py-3 shadow-xl text-sm">
                                  <p className="font-semibold mb-1.5 text-amber-300 text-xs uppercase tracking-wide">Vantar til að halda áfram</p>
                                  <ul className="space-y-1">
                                    {missingItems.map((item, idx) => (
                                      <li key={idx} className="flex items-start gap-2 text-slate-200 text-xs">
                                        <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                                        {item}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-slate-900 rotate-45" />
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}
              </div>
            )}

            {/* STEP: Result */}
            {step === "result" && generationGroups.length > 0 && (
              <MultiResultGallery
                groups={generationGroups}
                companySlug={companySlug}
                onReset={handleReset}
                company={company ? { name: company.name, logoUrl: company.logoUrl, primaryColor: company.primaryColor, secondaryColor: company.secondaryColor } : null}
              />
            )}
          </div>
      </div>
    </div>
  );
}
