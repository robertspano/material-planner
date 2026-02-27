"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, X, Search, Check, ImageIcon, AlertCircle,
  Package, ChevronRight, CheckSquare, Square, Upload, FileSpreadsheet,
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";

// ── Types ───────────────────────────────────────────────────────────
type DetectedCategory = "flisar" | "parket" | "vinyl" | "annad";

interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  swatchUrl: string | null;
  tileWidth: number | null;
  tileHeight: number | null;
  tileThickness: number | null;
  discountPercent: number | null;
  color: string | null;
  description: string | null;
  sourceUrl: string | null;
  confidence: "high" | "medium" | "low";
  detectedCategory: DetectedCategory;
}

interface ScrapeResponse {
  products: ScrapedProduct[];
  source: string;
  pageTitle: string;
  totalFound: number;
  warnings: string[];
}

interface Category {
  id: string;
  name: string;
}

interface Props {
  companyId: string;
  categories: Category[];
  onClose: () => void;
}

const CATEGORY_LABELS: Record<DetectedCategory, string> = {
  flisar: "Flísar",
  parket: "Parket",
  vinyl: "Vinyl",
  annad: "Annað",
};

const CATEGORY_COLORS: Record<DetectedCategory, string> = {
  flisar: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  parket: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  vinyl: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  annad: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

type Step = "input" | "preview" | "importing" | "done";

// ── Helpers ─────────────────────────────────────────────────────────
function formatISK(price: number | null): string {
  if (price === null) return "—";
  return price.toLocaleString("is-IS") + " kr";
}

function formatDimensions(w: number | null, h: number | null, t: number | null): string | null {
  if (!w && !h) return null;
  let s = "";
  if (w && h) s = `${w}×${h} cm`;
  else if (w) s = `${w} cm`;
  if (t) s += (s ? " · " : "") + `${t} mm`;
  return s || null;
}

/** Detect if a URL is a Google Sheets or Google Docs link */
function isGoogleDocUrl(url: string): boolean {
  return /docs\.google\.com\/(spreadsheets|document)/.test(url);
}

// ── Component ───────────────────────────────────────────────────────
export default function ScrapeProductsModal({ companyId, categories, onClose }: Props) {
  const [step, setStep] = useState<Step>("input");
  const [sheetUrl, setSheetUrl] = useState("");
  const [categoryOverride, setCategoryOverride] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState("");
  const [products, setProducts] = useState<ScrapedProduct[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pageTitle, setPageTitle] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import state
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importResult, setImportResult] = useState<{
    imported: number;
    failed: number;
    errors: { name: string; error: string }[];
  } | null>(null);

  // ── Process results ──
  const handleResults = useCallback((data: ScrapeResponse) => {
    setProducts(data.products);
    setWarnings(data.warnings);
    setPageTitle(data.pageTitle);
    const defaultSelected = new Set<number>();
    data.products.forEach((p, i) => {
      if (p.confidence !== "low") defaultSelected.add(i);
    });
    setSelected(defaultSelected);
    setStep("preview");
  }, []);

  // ── Parse Google Sheets/Docs URL ──
  const handleSheetUrl = useCallback(async () => {
    if (!sheetUrl.trim()) return;
    if (!isGoogleDocUrl(sheetUrl)) {
      setScrapeError("Slóðin þarf að vera Google Sheets eða Google Docs tengill");
      return;
    }
    setScraping(true);
    setScrapeError("");

    try {
      const res = await fetch("/api/super/parse-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Villa við að lesa skjal");
      }
      handleResults(await res.json());
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Villa við að lesa skjal");
    } finally {
      setScraping(false);
    }
  }, [sheetUrl, handleResults]);

  // ── Parse uploaded file ──
  const handleFileUpload = useCallback(async () => {
    if (!uploadedFile) return;
    setScraping(true);
    setScrapeError("");

    try {
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const res = await fetch("/api/super/parse-products", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Villa við að lesa skrá");
      }

      handleResults(await res.json());
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Villa við að lesa skrá");
    } finally {
      setScraping(false);
    }
  }, [uploadedFile, handleResults]);

  // ── Import selected products ──
  const handleImport = useCallback(async () => {
    const selectedProducts = products.filter((_, i) => selected.has(i));
    if (selectedProducts.length === 0) return;

    setStep("importing");
    setImportTotal(selectedProducts.length);
    setImportProgress(0);

    try {
      const res = await fetch("/api/super/import-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...(categoryOverride ? { categoryId: categoryOverride } : {}),
          sourceUrl: sheetUrl || uploadedFile?.name || "",
          products: selectedProducts.map(p => ({
            name: p.name,
            price: p.price,
            unit: "m2",
            imageUrl: p.imageUrl,
            surfaceTypes: ["floor"],
            tileWidth: p.tileWidth,
            tileHeight: p.tileHeight,
            tileThickness: p.tileThickness,
            discountPercent: p.discountPercent,
            description: p.description,
            color: p.color,
            detectedCategory: p.detectedCategory,
          })),
        }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Villa við innflutning");
      }

      const result = await res.json();
      setImportResult(result);
      setImportProgress(result.imported + result.failed);
      setStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/super/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/super/categories"] });
    } catch (err) {
      setImportResult({
        imported: 0,
        failed: selectedProducts.length,
        errors: [{ name: "Villa", error: err instanceof Error ? err.message : "Unknown" }],
      });
      setStep("done");
    }
  }, [products, selected, companyId, categoryOverride, sheetUrl, uploadedFile]);

  // ── Selection helpers ──
  const toggleAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((_, i) => i)));
    }
  };

  const toggleOne = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  };

  // ── File drop handler ──
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) setUploadedFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const fileExt = uploadedFile?.name.split(".").pop()?.toUpperCase() || "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="dark:bg-slate-800 bg-white rounded-2xl border dark:border-slate-700 border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between p-5 border-b dark:border-slate-700 border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/15 flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h2 className="text-base font-bold dark:text-white text-slate-900">
                {step === "input" && "Flytja inn vörur"}
                {step === "preview" && `${products.length} vörur fundust`}
                {step === "importing" && "Flyt inn vörur..."}
                {step === "done" && "Innflutningur lokið!"}
              </h2>
              {step === "preview" && pageTitle && (
                <p className="text-xs dark:text-slate-400 text-slate-500 mt-0.5">{pageTitle}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="dark:text-slate-400 text-slate-500 hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1: Input */}
          {step === "input" && (
            <div className="space-y-4">
              {/* File upload */}
              <div>
                <Label className="text-xs font-medium">Skrá</Label>
                <div
                  className={`mt-1.5 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    uploadedFile
                      ? "dark:border-purple-500/40 border-purple-300 dark:bg-purple-500/5 bg-purple-50"
                      : "dark:border-slate-600 border-slate-300 dark:hover:border-slate-500 hover:border-slate-400"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  {uploadedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-purple-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium dark:text-white text-slate-900">{uploadedFile.name}</p>
                        <p className="text-[10px] dark:text-slate-500 text-slate-400">
                          {(uploadedFile.size / 1024).toFixed(0)} KB · {fileExt}
                        </p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                        className="w-7 h-7 rounded-lg dark:bg-slate-700 bg-slate-200 flex items-center justify-center dark:text-slate-400 text-slate-500 hover:opacity-70"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 dark:text-slate-500 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm dark:text-slate-400 text-slate-500">
                        Dragðu skrá hingað eða <span className="text-purple-400 font-medium">smelltu</span>
                      </p>
                      <p className="text-[10px] dark:text-slate-600 text-slate-400 mt-1">
                        Excel (.xlsx), CSV, Numbers, ODS
                      </p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv,.tsv,.ods,.numbers"
                  onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                />
                {uploadedFile && (
                  <Button
                    onClick={handleFileUpload}
                    disabled={scraping}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white h-10 mt-3"
                  >
                    {scraping ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
                    {scraping ? "Les skrá..." : "Lesa skrá"}
                  </Button>
                )}
              </div>

              {/* Divider */}
              {!uploadedFile && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px dark:bg-slate-700 bg-slate-200" />
                  <span className="text-[10px] font-medium dark:text-slate-500 text-slate-400 uppercase">eða</span>
                  <div className="flex-1 h-px dark:bg-slate-700 bg-slate-200" />
                </div>
              )}

              {/* Google Sheets/Docs URL */}
              {!uploadedFile && (
                <div>
                  <Label className="text-xs font-medium">Google Sheets / Docs slóð</Label>
                  <div className="flex gap-2 mt-1.5">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 dark:text-slate-500 text-slate-400" />
                      <Input
                        value={sheetUrl}
                        onChange={(e) => setSheetUrl(e.target.value)}
                        placeholder="docs.google.com/spreadsheets/..."
                        className="pl-9 h-10"
                        onKeyDown={(e) => { if (e.key === "Enter") handleSheetUrl(); }}
                      />
                    </div>
                    <Button
                      onClick={handleSheetUrl}
                      disabled={scraping || !sheetUrl.trim()}
                      className="bg-purple-600 hover:bg-purple-700 text-white h-10 px-5"
                    >
                      {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sækja"}
                    </Button>
                  </div>
                  <p className="text-[10px] dark:text-slate-500 text-slate-400 mt-1">
                    Skjalið þarf að vera deilt (Share → Anyone with the link)
                  </p>
                </div>
              )}

              {/* Error */}
              {scrapeError && (
                <p className="text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {scrapeError}
                </p>
              )}

              {/* Optional category override */}
              {categories.length > 0 && (
                <div>
                  <Label className="text-xs font-medium">Flokkur (valfrjálst)</Label>
                  <select
                    value={categoryOverride}
                    onChange={(e) => setCategoryOverride(e.target.value)}
                    className="mt-1.5 w-full h-10 rounded-lg border dark:border-slate-600 border-slate-300 dark:bg-slate-700 bg-white px-3 text-sm dark:text-slate-200 text-slate-800"
                  >
                    <option value="">Sjálfvirkt — greina flokk</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] dark:text-slate-500 text-slate-400 mt-1">
                    Ef ekkert er valið greinir kerfið flokkinn sjálfkrafa (flísar, parket, vinyl)
                  </p>
                </div>
              )}

              {/* Info */}
              <div className="dark:bg-slate-700/30 bg-slate-50 rounded-xl p-4 space-y-2">
                <p className="text-xs dark:text-slate-400 text-slate-500">
                  Hladdu upp <strong>Excel</strong>, <strong>CSV</strong>, <strong>Numbers</strong> eða <strong>Google Sheets</strong> skjali.
                  Fyrsta röðin ætti að vera hausar (nafn, verð, stærð, mynd...).
                </p>
                <p className="text-[10px] dark:text-slate-500 text-slate-400">
                  Flokkar búnir til sjálfkrafa: Flísar, Parket, Vinyl
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === "preview" && (
            <div className="space-y-3">
              {warnings.length > 0 && (
                <div className="dark:bg-amber-500/10 bg-amber-50 rounded-lg p-3 space-y-1">
                  {warnings.map((w, i) => (
                    <p key={i} className="text-xs dark:text-amber-400 text-amber-600 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-sm dark:text-slate-300 text-slate-700 hover:opacity-80"
                >
                  {selected.size === products.length ? (
                    <CheckSquare className="w-4 h-4 text-purple-400" />
                  ) : (
                    <Square className="w-4 h-4 dark:text-slate-500 text-slate-400" />
                  )}
                  <span>Velja allar ({products.length})</span>
                </button>
                <span className="text-xs dark:text-slate-500 text-slate-400">
                  {selected.size} valdar
                </span>
              </div>

              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {products.map((product, i) => {
                  const isSelected = selected.has(i);
                  const dims = formatDimensions(product.tileWidth, product.tileHeight, product.tileThickness);

                  return (
                    <div
                      key={i}
                      onClick={() => toggleOne(i)}
                      className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                        isSelected
                          ? "dark:bg-purple-500/10 bg-purple-50 border dark:border-purple-500/30 border-purple-200"
                          : "dark:bg-slate-700/30 bg-slate-50 border dark:border-slate-700/30 border-slate-200 opacity-60 hover:opacity-80"
                      }`}
                    >
                      <div className="flex-shrink-0">
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-purple-400" />
                        ) : (
                          <Square className="w-4 h-4 dark:text-slate-500 text-slate-400" />
                        )}
                      </div>

                      <div className="w-14 h-14 rounded-lg dark:bg-slate-700 bg-slate-200 flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = "none";
                            }}
                          />
                        ) : (
                          <ImageIcon className="w-5 h-5 dark:text-slate-500 text-slate-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium dark:text-white text-slate-900 truncate">
                            {product.name}
                          </p>
                          {!categoryOverride && product.detectedCategory && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-md border flex-shrink-0 ${CATEGORY_COLORS[product.detectedCategory]}`}>
                              {CATEGORY_LABELS[product.detectedCategory]}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {product.price !== null && (
                            <span className="text-xs font-semibold dark:text-emerald-400 text-emerald-600">
                              {formatISK(product.price)}
                            </span>
                          )}
                          {product.discountPercent && (
                            <span className="text-[9px] font-semibold text-red-400">
                              -{product.discountPercent}%
                            </span>
                          )}
                          {dims && (
                            <span className="text-[10px] dark:text-slate-500 text-slate-400">
                              {dims}
                            </span>
                          )}
                          {product.color && (
                            <span className="text-[10px] dark:text-blue-400/70 text-blue-500/70">
                              {product.color}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0">
                        <div className={`w-2 h-2 rounded-full ${
                          product.confidence === "high" ? "bg-emerald-500" :
                          product.confidence === "medium" ? "bg-amber-500" : "bg-slate-500"
                        }`} title={product.confidence} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {products.length === 0 && (
                <div className="text-center py-10">
                  <Package className="w-10 h-10 dark:text-slate-600 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm dark:text-slate-400 text-slate-500">Engar vörur fundust</p>
                  <Button onClick={() => setStep("input")} variant="ghost" className="mt-3">
                    Reyna aftur
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Importing */}
          {step === "importing" && (
            <div className="text-center py-10 space-y-5">
              <Loader2 className="w-10 h-10 animate-spin text-purple-400 mx-auto" />
              <div>
                <p className="text-sm font-medium dark:text-white text-slate-900">
                  Flyt inn {importTotal} vörur...
                </p>
                <p className="text-xs dark:text-slate-400 text-slate-500 mt-1">
                  Sæki myndir og vista í gagnagrunn
                </p>
              </div>
              <div className="w-full max-w-xs mx-auto">
                <div className="h-2 rounded-full dark:bg-slate-700 bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500 transition-all duration-500"
                    style={{ width: `${importTotal > 0 ? (importProgress / importTotal) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Done */}
          {step === "done" && importResult && (
            <div className="text-center py-6 space-y-4">
              {importResult.imported > 0 ? (
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
                  <Check className="w-7 h-7 text-emerald-400" />
                </div>
              ) : (
                <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto">
                  <AlertCircle className="w-7 h-7 text-red-400" />
                </div>
              )}

              <div>
                <p className="text-lg font-bold dark:text-white text-slate-900">
                  {importResult.imported > 0
                    ? `${importResult.imported} ${importResult.imported === 1 ? "vara" : "vörur"} fluttar inn`
                    : "Innflutningur mistókst"
                  }
                </p>
                {importResult.failed > 0 && (
                  <p className="text-sm dark:text-red-400 text-red-500 mt-1">
                    {importResult.failed} {importResult.failed === 1 ? "villa" : "villur"}
                  </p>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <div className="dark:bg-red-500/10 bg-red-50 rounded-xl p-3 text-left max-h-[150px] overflow-y-auto">
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs dark:text-red-400 text-red-600 py-0.5">
                      <strong>{e.name}:</strong> {e.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="p-4 border-t dark:border-slate-700 border-slate-200 flex-shrink-0">
          {step === "preview" && products.length > 0 && (
            <div className="flex items-center gap-3">
              <Button onClick={() => setStep("input")} variant="ghost" className="h-10">
                Til baka
              </Button>
              <Button
                onClick={handleImport}
                disabled={selected.size === 0}
                className="flex-1 bg-purple-600 hover:bg-purple-700 text-white h-10"
              >
                <ChevronRight className="w-4 h-4 mr-1.5" />
                Flytja inn {selected.size} {selected.size === 1 ? "vöru" : "vörur"}
              </Button>
            </div>
          )}
          {step === "done" && (
            <Button onClick={onClose} className="w-full bg-purple-600 hover:bg-purple-700 text-white h-10">
              Loka
            </Button>
          )}
          {step === "input" && (
            <p className="text-[10px] dark:text-slate-600 text-slate-300 text-center">
              Styður Excel, CSV, Google Sheets, Google Docs, Numbers og ODS
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
