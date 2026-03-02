"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQueries } from "@tanstack/react-query";
import { Loader2, Download, RotateCcw, AlertCircle, ArrowLeftRight, ChevronLeft, ChevronRight, Sparkles, X, Maximize2, FileText, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialEstimate } from "@/components/planner/material-estimate";

interface GenerationResult {
  id: string;
  imageUrl: string;
  surfaceType: string;
  createdAt: string;
}

interface GenerationData {
  id: string;
  status: string;
  errorMessage: string | null;
  results: GenerationResult[];
}

export interface GenerationGroup {
  roomImageUrl: string;
  generationId: string;
  surfaceType: "floor" | "wall" | "both";
  product: {
    id: string;
    name: string;
    imageUrl: string;
    swatchUrl?: string | null;
    tileWidth?: number | null;
    tileHeight?: number | null;
    price?: number | null;
    unit?: string;
    discountPercent?: number | null;
    category?: { name: string };
  };
  wallProduct?: {
    id: string;
    name: string;
    imageUrl: string;
    swatchUrl?: string | null;
    tileWidth?: number | null;
    tileHeight?: number | null;
    price?: number | null;
    unit?: string;
    discountPercent?: number | null;
    category?: { name: string };
  };
}

interface MultiResultGalleryProps {
  groups: GenerationGroup[];
  companySlug: string;
  onReset: () => void;
  company?: {
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    secondaryColor: string;
  } | null;
}

// ---------- Smooth Before/After slider (ref-based, no React re-renders) ----------
function BeforeAfterSlider({ beforeUrl, afterUrl, fullscreen }: { beforeUrl: string; afterUrl: string; fullscreen?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const posRef = useRef(50);
  const rafRef = useRef<number>(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 100);
    return () => clearTimeout(t);
  }, []);

  const applyPosition = useCallback((pct: number) => {
    if (clipRef.current) clipRef.current.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    if (lineRef.current) lineRef.current.style.left = `${pct}%`;
  }, []);

  // Initialize position
  useEffect(() => {
    applyPosition(50);
  }, [applyPosition]);

  const updateSlider = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    const pct = Math.max(2, Math.min(98, (x / rect.width) * 100));
    posRef.current = pct;
    // Use rAF for smooth 60fps updates
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => applyPosition(pct));
  }, [applyPosition]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      el.setPointerCapture(e.pointerId);
      if (handleRef.current) handleRef.current.style.transform = "translate(-50%, -50%) scale(1.15)";
      updateSlider(e.clientX);
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      updateSlider(e.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
      if (handleRef.current) handleRef.current.style.transform = "translate(-50%, -50%) scale(1)";
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateSlider]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden select-none touch-none cursor-col-resize ${
        fullscreen ? "w-full h-full" : "rounded-2xl border border-slate-200 aspect-[16/9]"
      }`}
    >
      {/* After image (full background) */}
      <img src={afterUrl} alt="Eftir" className={`absolute inset-0 w-full h-full ${fullscreen ? "object-contain" : "object-cover"}`} draggable={false} />

      {/* Before image (clipped — updated via ref) */}
      <div
        ref={clipRef}
        className="absolute inset-0 will-change-[clip-path]"
        style={{ clipPath: "inset(0 50% 0 0)" }}
      >
        <img
          src={beforeUrl}
          alt="Fyrir"
          className={`absolute inset-0 w-full h-full ${fullscreen ? "object-contain" : "object-cover"}`}
          draggable={false}
        />
      </div>

      {/* Slider line + handle — updated via ref */}
      <div
        ref={lineRef}
        className="absolute top-0 bottom-0 z-10 will-change-[left]"
        style={{ left: "50%", transform: "translateX(-50%)" }}
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-white shadow-[0_0_8px_rgba(0,0,0,0.3)]" />
        <div
          ref={handleRef}
          className={`absolute top-1/2 left-1/2 w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center transition-[transform] duration-200 ${
            loaded ? "" : "!scale-0"
          }`}
          style={{ transform: "translate(-50%, -50%) scale(1)" }}
        >
          <ArrowLeftRight className="w-5 h-5 text-slate-600" />
        </div>
      </div>

      {/* Labels */}
      <div className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-white text-xs font-semibold z-10 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}>
        Fyrir
      </div>
      <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-sm text-white text-xs font-semibold z-10 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}>
        Eftir
      </div>
    </div>
  );
}

// ---------- Cinema Mode Lightbox ----------
function CinemaMode({
  activeImage,
  activeRoomImage,
  showComparison,
  setShowComparison,
  productName,
  surfaceType,
  counter,
  hasMultiple,
  onPrev,
  onNext,
  onClose,
  onDownload,
}: {
  activeImage: string;
  activeRoomImage: string;
  showComparison: boolean;
  setShowComparison: (v: boolean) => void;
  productName: string;
  surfaceType: string;
  counter: string;
  hasMultiple: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDownload: () => void;
}) {
  const [entered, setEntered] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Animate in
  useEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
  }, []);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onPrev, onNext]);

  // Touch/swipe for mobile navigation
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (showComparison) return; // don't interfere with slider
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, [showComparison]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || showComparison) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    // Only trigger if horizontal swipe > 60px and more horizontal than vertical
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0) onPrev();
      else onNext();
    }
  }, [showComparison, onPrev, onNext]);

  const handleClose = useCallback(() => {
    setEntered(false);
    setTimeout(onClose, 250);
  }, [onClose]);

  const surfaceLabel = surfaceType === "floor" ? "Gólf" : surfaceType === "both" ? "Gólf og veggir" : "Veggir";

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex flex-col transition-all duration-300 ease-out ${
        entered ? "bg-black/95" : "bg-black/0"
      }`}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Top bar — close, product info, counter */}
      <div className={`flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 transition-all duration-300 ${entered ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}`}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-2 py-0.5 text-[10px] font-bold rounded text-white/80 bg-white/10">
            {surfaceLabel}
          </span>
          <span className="text-sm sm:text-base font-semibold text-white truncate">{productName}</span>
          {hasMultiple && (
            <span className="text-xs text-white/50 hidden sm:inline">{counter}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Download */}
          <button
            onClick={onDownload}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            title="Sækja mynd"
          >
            <Download className="w-4 h-4" />
          </button>
          {/* Close */}
          <button
            onClick={handleClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div
        className={`flex-1 relative flex items-center justify-center px-4 sm:px-16 transition-all duration-300 ${
          entered ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {showComparison ? (
          <div className="w-full h-full max-w-[90vw] max-h-[75vh] flex items-center justify-center">
            <BeforeAfterSlider beforeUrl={activeRoomImage} afterUrl={activeImage} fullscreen />
          </div>
        ) : (
          <img
            src={activeImage}
            alt="Niðurstaða"
            className="max-w-full max-h-[75vh] object-contain rounded-lg shadow-2xl"
            draggable={false}
          />
        )}

        {/* Navigation arrows */}
        {hasMultiple && (
          <>
            <button
              onClick={onPrev}
              className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all hover:scale-110"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={onNext}
              className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all hover:scale-110"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      {/* Bottom bar — mode switcher + counter on mobile */}
      <div className={`flex items-center justify-center px-4 sm:px-6 py-3 sm:py-4 gap-4 transition-all duration-300 ${entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
        {/* Mobile counter */}
        {hasMultiple && (
          <span className="text-xs text-white/40 sm:hidden">{counter}</span>
        )}

        {/* Mode switcher */}
        <div className="relative flex bg-white/10 rounded-full p-1 backdrop-blur-sm">
          {/* Sliding pill */}
          <div
            className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out"
            style={{
              width: "calc(50% - 4px)",
              left: showComparison ? "calc(50% + 2px)" : "4px",
              backgroundColor: "var(--brand-primary)",
            }}
          />
          <button
            onClick={() => setShowComparison(false)}
            className={`relative z-10 flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-200 whitespace-nowrap ${
              !showComparison ? "text-white" : "text-white/40 hover:text-white/60"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Niðurstaða
          </button>
          <button
            onClick={() => setShowComparison(true)}
            className={`relative z-10 flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-200 whitespace-nowrap ${
              showComparison ? "text-white" : "text-white/40 hover:text-white/60"
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Fyrir og eftir
          </button>
        </div>

        {/* Keyboard hints on desktop */}
        {hasMultiple && (
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-white/25">
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">←</kbd>
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono">→</kbd>
            <span className="ml-1">fletta</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ---------- Main gallery component ----------
export function MultiResultGallery({ groups, companySlug, onReset, company }: MultiResultGalleryProps) {
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [showComparison, setShowComparison] = useState(false);
  const [cinemaOpen, setCinemaOpen] = useState(false);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Preload all room images immediately so comparison is instant
  useEffect(() => {
    const urls = [...new Set(groups.map(g => g.roomImageUrl))];
    urls.forEach(url => {
      const img = new Image();
      img.src = url;
    });
  }, [groups]);

  const uniqueGenIds = useMemo(() => {
    return [...new Set(groups.map(g => g.generationId))];
  }, [groups]);

  const queries = useQueries({
    queries: uniqueGenIds.map(genId => ({
      queryKey: [`/api/planner/generation/${genId}?company=${companySlug}`],
      refetchInterval: (query: { state: { data: GenerationData | undefined } }) => {
        const data = query.state.data;
        if (!data) return 2000;
        if (data.status === "completed" || data.status === "failed") return false;
        return 2000;
      },
    })),
  });

  const genDataMap = useMemo(() => {
    const map = new Map<string, GenerationData>();
    uniqueGenIds.forEach((genId, i) => {
      const data = queries[i]?.data as GenerationData | undefined;
      if (data) map.set(genId, data);
    });
    return map;
  }, [uniqueGenIds, queries]);

  const resultItems = useMemo(() => {
    return groups.map(group => {
      const genData = genDataMap.get(group.generationId);
      const status = genData?.status || "pending";
      // Match result by surface type; for "both" mode also match "floor" as it's stored as one combined result
      const result = genData?.results?.find(r => r.surfaceType === group.surfaceType)
        || genData?.results?.find(r => group.surfaceType === "both" && (r.surfaceType === "floor" || r.surfaceType === "both"))
        || (genData?.results?.length === 1 ? genData.results[0] : null);
      return { group, status, result, errorMessage: genData?.errorMessage };
    });
  }, [groups, genDataMap]);

  const completedCount = resultItems.filter(r => r.result).length;
  const failedCount = resultItems.filter(r => r.status === "failed").length;
  const totalCount = resultItems.length;
  const allDone = resultItems.every(r => r.status === "completed" || r.status === "failed");

  // Elapsed timer for progress
  useEffect(() => {
    if (allDone) return;
    const timer = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(timer);
  }, [allDone, startTime]);

  // ETA calculation
  const progressPct = totalCount > 0 ? (completedCount + failedCount) / totalCount * 100 : 0;
  const avgTimePerItem = (completedCount + failedCount) > 0
    ? elapsed / (completedCount + failedCount)
    : 25000; // default estimate 25s
  const estimatedRemaining = Math.max(0, (totalCount - completedCount - failedCount) * avgTimePerItem);
  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, "0")}`;
  };

  // Collect unique error messages for display
  const errorMessages = useMemo(() => {
    const msgs = new Set<string>();
    resultItems.forEach(r => {
      if (r.status === "failed" && r.errorMessage) {
        // Clean up error messages for user display
        let msg = r.errorMessage;
        if (msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("resource_exhausted")) {
          msg = "Gemini API hámarks fjöldi beiðna náðist — reyndu aftur eftir smá stund.";
        } else if (msg.includes("Gemini did not return an image")) {
          msg = "Gemini skilaði ekki mynd — reyndu aftur.";
        } else if (msg.includes("fetch image") || msg.includes("Failed to fetch")) {
          msg = "Ekki tókst að sækja mynd — athugaðu nettengingu.";
        } else if (msg.length > 120) {
          msg = msg.substring(0, 120) + "…";
        }
        msgs.add(msg);
      }
    });
    return [...msgs];
  }, [resultItems]);

  useEffect(() => {
    const firstCompleted = resultItems.findIndex(r => r.result);
    if (firstCompleted >= 0 && !resultItems[selectedIdx]?.result) {
      setSelectedIdx(firstCompleted);
    }
  }, [resultItems, selectedIdx]);

  const activeItem = resultItems[selectedIdx];
  const activeImage = activeItem?.result?.imageUrl;
  const activeRoomImage = activeItem?.group.roomImageUrl;

  // Completed indices for arrow navigation
  const completedIndices = useMemo(() => resultItems.map((r, i) => r.result ? i : -1).filter(i => i >= 0), [resultItems]);
  const currentPosInCompleted = completedIndices.indexOf(selectedIdx);

  const goNext = useCallback(() => {
    if (completedIndices.length <= 1) return;
    const next = currentPosInCompleted >= completedIndices.length - 1 ? 0 : currentPosInCompleted + 1;
    setSelectedIdx(completedIndices[next]);
    setShowComparison(false);
  }, [completedIndices, currentPosInCompleted]);

  const goPrev = useCallback(() => {
    if (completedIndices.length <= 1) return;
    const prev = currentPosInCompleted <= 0 ? completedIndices.length - 1 : currentPosInCompleted - 1;
    setSelectedIdx(completedIndices[prev]);
    setShowComparison(false);
  }, [completedIndices, currentPosInCompleted]);

  // Download all helper
  const downloadAll = useCallback(() => {
    resultItems.forEach((item) => {
      if (item.result?.imageUrl) {
        const a = document.createElement("a");
        a.href = item.result.imageUrl;
        a.download = "";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
  }, [resultItems]);

  // Download current
  const downloadCurrent = useCallback(() => {
    if (!activeImage) return;
    const a = document.createElement("a");
    a.href = activeImage;
    a.download = "";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [activeImage]);

  // Collect full estimate data from each MaterialEstimate
  interface EstimateData { area: number; totalNeeded: number; unitPrice: number | null; totalPrice: number | null }
  const [estimateDataMap, setEstimateDataMap] = useState<Record<string, EstimateData>>({});
  const handleEstimateChange = useCallback((key: string) => (data: EstimateData) => {
    setEstimateDataMap(prev => {
      const existing = prev[key];
      if (existing && existing.area === data.area && existing.totalPrice === data.totalPrice) return prev;
      return { ...prev, [key]: data };
    });
  }, []);

  const combinedTotal = useMemo(() => {
    const values = Object.values(estimateDataMap).map(d => d.totalPrice).filter((v): v is number => v != null && v > 0);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  }, [estimateDataMap]);

  const hasMultipleEstimates = resultItems.filter(r => r.result).length > 1;

  const formatPrice = (n: number) => n.toLocaleString("is-IS");

  const surfaceLabel = (s: string) => s === "floor" ? "Gólf" : s === "both" ? "Gólf og veggir" : "Veggir";

  // Build quote items from estimate data
  const buildQuoteItems = useCallback(() => {
    return resultItems
      .filter(item => item.result)
      .map((item, idx) => {
        const product = item.group.product;
        const estimateKey = `${item.group.generationId}-${product.id}`;
        const floorData = estimateDataMap[`${estimateKey}-floor`];
        const wallData = estimateDataMap[`${estimateKey}-wall`] || estimateDataMap[`${estimateKey}-wall-both`];
        return {
          productName: product.name,
          surfaceType: item.group.surfaceType,
          price: product.price,
          discountPercent: product.discountPercent,
          unit: product.unit || "m2",
          tileWidth: product.tileWidth,
          tileHeight: product.tileHeight,
          area: floorData?.area || wallData?.area || 0,
          totalNeeded: floorData?.totalNeeded || wallData?.totalNeeded || 0,
          unitPrice: floorData?.unitPrice ?? wallData?.unitPrice ?? product.price,
          totalPrice: (floorData?.totalPrice || 0) + (wallData?.totalPrice || 0),
          resultImageUrl: item.result!.imageUrl,
          roomImageUrl: item.group.roomImageUrl,
          index: idx + 1,
        };
      });
  }, [resultItems, estimateDataMap]);

  // Generate PDF for combined quote — sends ALL estimate data
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const handleDownloadQuote = useCallback(async () => {
    setGeneratingPdf(true);
    try {
      const items = buildQuoteItems();
      const res = await fetch("/api/planner/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companySlug,
          items,
          combinedTotal,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tilbod.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF error:", err);
    } finally {
      setGeneratingPdf(false);
    }
  }, [buildQuoteItems, companySlug, combinedTotal]);

  // Send quote via email
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState("");

  const handleSendQuote = useCallback(async () => {
    if (!sendEmail) return;
    setSendingEmail(true);
    setSendError("");
    try {
      // First generate the PDF (which also saves it to Cloudinary and returns the URL in header)
      const items = buildQuoteItems();
      const pdfRes = await fetch("/api/planner/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companySlug, items, combinedTotal }),
      });
      if (!pdfRes.ok) throw new Error("Villa vi\u00F0 a\u00F0 b\u00FAa til PDF");

      // Get the PDF URL from the response header
      const pdfUrl = pdfRes.headers.get("X-Quote-Url");
      if (!pdfUrl) throw new Error("PDF vistun t\u00F3kst ekki");

      // Now send the email with the PDF URL
      const sendRes = await fetch("/api/planner/quote/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companySlug,
          email: sendEmail,
          pdfUrl,
          productNames: items.map(it => it.productName),
          combinedTotal,
        }),
      });

      if (!sendRes.ok) {
        const errData = await sendRes.json().catch(() => ({}));
        throw new Error(errData.error || "Villa vi\u00F0 a\u00F0 senda");
      }

      setSendSuccess(true);
      setTimeout(() => {
        setShowSendModal(false);
        setSendSuccess(false);
        setSendEmail("");
      }, 2000);
    } catch (err) {
      console.error("Send error:", err);
      setSendError(err instanceof Error ? err.message : "Villa kom upp");
    } finally {
      setSendingEmail(false);
    }
  }, [sendEmail, buildQuoteItems, companySlug, combinedTotal]);

  return (
    <div className="space-y-3">
      {/* Generating state — scanner animation over room images */}
      {!allDone && (
        <div className="space-y-4">
          {/* Room images with scanner effect */}
          <div className={`grid gap-3 ${resultItems.length === 1 ? "grid-cols-1" : resultItems.length === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
            {resultItems.map((item, i) => {
              const isDone = !!item.result;
              const isFailed = item.status === "failed";
              return (
                <div
                  key={i}
                  className={`relative rounded-2xl overflow-hidden border-2 transition-all ${
                    isDone
                      ? "border-emerald-400"
                      : isFailed
                      ? "border-red-300"
                      : "border-slate-200"
                  } ${resultItems.length === 1 ? "aspect-[16/9]" : "aspect-[4/3]"}`}
                >
                  {/* Room image */}
                  <img
                    src={isDone && item.result ? item.result.imageUrl : item.group.roomImageUrl}
                    alt=""
                    className={`w-full h-full object-cover transition-all duration-700 ${isDone ? "" : "brightness-[0.85]"}`}
                  />

                  {/* Scanner overlay — only on generating items */}
                  {!isDone && !isFailed && (
                    <>
                      {/* Subtle dark overlay */}
                      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/30 z-[1]" />

                      {/* Green scanner — static container, only the line moves */}
                      <div className="absolute inset-0 z-[2] pointer-events-none overflow-hidden">
                        {/* The moving scan line + glow */}
                        <div className="animate-scan-line">
                          {/* Visible green line */}
                          <div className="absolute inset-0"
                            style={{ background: "linear-gradient(180deg, transparent 0%, #22c55e 15%, #4ade80 50%, #22c55e 85%, transparent 100%)" }}
                          />
                          {/* Wide glow around the line */}
                          <div className="absolute top-0 bottom-0 -left-[30px] w-[64px]"
                            style={{ background: "linear-gradient(90deg, transparent, rgba(34,197,94,0.12), rgba(74,222,128,0.3), rgba(34,197,94,0.12), transparent)" }}
                          />
                        </div>
                      </div>

                      {/* Horizontal scan lines for tech feel */}
                      <div className="absolute inset-0 pointer-events-none opacity-[0.04] z-[1]"
                        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)" }}
                      />
                    </>
                  )}

                  {/* Completed overlay — checkmark */}
                  {isDone && (
                    <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10">
                      <div className="w-12 h-12 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    </div>
                  )}

                  {/* Failed overlay */}
                  {isFailed && (
                    <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
                      <AlertCircle className="w-8 h-8 text-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Status text — simple and clean */}
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-slate-700">
              {completedCount > 0 && completedCount < totalCount
                ? `${completedCount} af ${totalCount} tilbúnar…`
                : "Myndar sjónræna sýn…"
              }
            </p>
            <p className="text-xs text-slate-400">
              Tekur u.þ.b. 20–40 sekúndur
            </p>
          </div>
        </div>
      )}

      {/* Main image viewer with floating overlays */}
      {activeImage && activeRoomImage && (
        <div className="relative mt-6">
          {/* Image or Slider */}
          <div className="group">
            {showComparison ? (
              <BeforeAfterSlider beforeUrl={activeRoomImage} afterUrl={activeImage} />
            ) : (
              <div
                className="rounded-2xl overflow-hidden border border-slate-200 aspect-[16/9] relative cursor-pointer"
                onClick={() => setCinemaOpen(true)}
              >
                <img
                  src={activeImage}
                  alt="Niðurstaða"
                  className="w-full h-full object-cover"
                />
                {/* Expand hint on hover */}
                <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors duration-200 flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 scale-90 group-hover:scale-100">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation arrows */}
          {completedIndices.length > 1 && (
            <>
              <button
                onClick={goPrev}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all opacity-100 sm:opacity-70 sm:hover:opacity-100 z-20"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={goNext}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center transition-all opacity-100 sm:opacity-70 sm:hover:opacity-100 z-20"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          {/* Floating overlays */}
          {!showComparison && completedIndices.length > 1 && (
            <div className="absolute top-3 left-3 z-20 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-semibold">
              {currentPosInCompleted + 1} / {completedIndices.length}
            </div>
          )}
          {!allDone && (
            <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/50 backdrop-blur-sm text-white text-xs font-medium">
              <Loader2 className="w-3 h-3 animate-spin" />
              {completedCount}/{totalCount}
            </div>
          )}

          {/* Mode switcher — inside image, bottom center */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <div className="relative flex bg-white/90 backdrop-blur-sm rounded-full p-1 shadow-lg border border-white/50">
              <div
                className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-out shadow-md"
                style={{
                  width: "calc(50% - 4px)",
                  left: showComparison ? "calc(50% + 2px)" : "4px",
                  backgroundColor: "var(--brand-primary)",
                }}
              />
              <button
                onClick={() => setShowComparison(false)}
                className={`relative z-10 flex items-center justify-center gap-1.5 sm:gap-2 px-3.5 sm:px-6 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-200 whitespace-nowrap ${
                  !showComparison ? "text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Niðurstaða
              </button>
              <button
                onClick={() => setShowComparison(true)}
                className={`relative z-10 flex items-center justify-center gap-1.5 sm:gap-2 px-3.5 sm:px-6 py-2 sm:py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-colors duration-200 whitespace-nowrap ${
                  showComparison ? "text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Fyrir og eftir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Thumbnail selector — RIGHT BELOW main image ── */}
      {resultItems.filter(r => r.result).length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mt-1">
          {resultItems.map((item, i) => {
            if (!item.result) {
              if (item.status === "failed") {
                return (
                  <div key={i} className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border border-red-200 flex items-center justify-center bg-slate-50">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  </div>
                );
              }
              if (!allDone) {
                return (
                  <div key={i} className="flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border border-slate-200 flex items-center justify-center bg-slate-50">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  </div>
                );
              }
              return null;
            }
            const isActive = i === selectedIdx;
            return (
              <button
                key={i}
                onClick={() => { setSelectedIdx(i); setShowComparison(false); }}
                className={`relative flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border-2 transition-all ${
                  isActive
                    ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <img
                  src={item.result.imageUrl}
                  alt={item.group.product.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-1 py-0.5">
                  <span className="text-[8px] text-white font-medium truncate block">{item.group.product.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Action buttons — compact row */}
      {activeImage && activeItem && (
        <div className="flex flex-wrap items-center gap-2">
          <a href={activeImage} download target="_blank" rel="noopener noreferrer" className="flex-1 sm:flex-none">
            <Button size="sm" className="text-white h-9 px-3 w-full sm:w-auto" style={{ backgroundColor: "var(--brand-primary)" }}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Sækja mynd
            </Button>
          </a>
          {completedIndices.length > 1 && (
            <Button
              size="sm"
              className="text-white h-9 px-3 flex-1 sm:flex-none"
              style={{ backgroundColor: "var(--brand-primary)" }}
              onClick={downloadAll}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Allar ({completedIndices.length})
            </Button>
          )}
          <Button
            onClick={() => setCinemaOpen(true)}
            variant="outline"
            size="sm"
            className="h-9 px-3 flex-1 sm:flex-none"
          >
            <Maximize2 className="w-3.5 h-3.5 mr-1.5" /> Stækka
          </Button>
          <Button onClick={onReset} variant="outline" size="sm" className="h-9 px-3 flex-1 sm:flex-none">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Ný sýn
          </Button>
        </div>
      )}

      {/* ── Material estimates — ONE per completed result ── */}
      {completedCount > 0 && (
        <div className="space-y-3">
          {resultItems.map((item, i) => {
            if (!item.result) return null;
            const product = item.group.product;
            const isActive = i === selectedIdx;
            const estimateKey = `${item.group.generationId}-${product.id}`;

            return (
              <div
                key={i}
                className={`rounded-2xl border transition-all ${
                  isActive
                    ? "border-[var(--brand-primary)]/30 ring-1 ring-[var(--brand-primary)]/20"
                    : "border-slate-200"
                }`}
              >
                {/* Result header — small thumbnail + product info */}
                <button
                  onClick={() => { setSelectedIdx(i); setShowComparison(false); }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-50/50 transition-colors rounded-t-2xl"
                >
                  {/* Mini result thumbnail */}
                  <div className={`w-16 h-11 rounded-lg overflow-hidden border-2 flex-shrink-0 ${
                    isActive ? "border-[var(--brand-primary)]" : "border-slate-200"
                  }`}>
                    <img src={item.result.imageUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                  {/* Product swatch — always show the tile color, not room scene */}
                  <div className="w-8 h-8 rounded-md overflow-hidden border border-slate-200 flex-shrink-0">
                    <img
                      src={product.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* Product name + surface type */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 text-[9px] font-bold rounded text-white flex-shrink-0"
                        style={{ backgroundColor: "var(--brand-primary)" }}
                      >
                        {item.group.surfaceType === "both" ? "Gólf" : surfaceLabel(item.group.surfaceType)}
                      </span>
                      <p className="text-sm font-semibold text-slate-900 truncate">{product.name}</p>
                    </div>
                    {product.tileWidth && product.tileHeight && (
                      <span className="text-[11px] text-slate-400">
                        {product.tileWidth} × {product.tileHeight} cm
                      </span>
                    )}
                  </div>
                  {/* Number badge */}
                  {hasMultipleEstimates && (
                    <span className="text-xs font-bold text-slate-400 flex-shrink-0">#{i + 1}</span>
                  )}
                </button>

                {/* The actual MaterialEstimate */}
                <div className="px-0">
                  {/* Floor estimate */}
                  {(item.group.surfaceType === "floor" || item.group.surfaceType === "both") && (
                    <MaterialEstimate
                      product={{
                        id: product.id,
                        name: product.name,
                        price: product.price ?? null,
                        unit: product.unit || "m²",
                        discountPercent: product.discountPercent,
                        tileWidth: product.tileWidth,
                        tileHeight: product.tileHeight,
                      }}
                      surfaceType="floor"
                      companySlug={companySlug}
                      roomImageUrl={item.group.roomImageUrl}
                      generationId={item.group.generationId}
                      resultImageUrl={item.result!.imageUrl}
                      company={company}
                      onEstimateChange={handleEstimateChange(`${estimateKey}-floor`)}
                      compact={hasMultipleEstimates}
                    />
                  )}
                  {/* Wall estimate */}
                  {item.group.surfaceType === "wall" && (
                    <MaterialEstimate
                      product={{
                        id: product.id,
                        name: product.name,
                        price: product.price ?? null,
                        unit: product.unit || "m²",
                        discountPercent: product.discountPercent,
                        tileWidth: product.tileWidth,
                        tileHeight: product.tileHeight,
                      }}
                      surfaceType="wall"
                      companySlug={companySlug}
                      roomImageUrl={item.group.roomImageUrl}
                      generationId={item.group.generationId}
                      resultImageUrl={item.result!.imageUrl}
                      company={company}
                      onEstimateChange={handleEstimateChange(`${estimateKey}-wall`)}
                      compact={hasMultipleEstimates}
                    />
                  )}
                  {item.group.surfaceType === "both" && item.group.wallProduct && (
                    <MaterialEstimate
                      product={{
                        id: item.group.wallProduct.id,
                        name: item.group.wallProduct.name,
                        price: item.group.wallProduct.price ?? null,
                        unit: item.group.wallProduct.unit || "m²",
                        discountPercent: item.group.wallProduct.discountPercent,
                        tileWidth: item.group.wallProduct.tileWidth,
                        tileHeight: item.group.wallProduct.tileHeight,
                      }}
                      surfaceType="wall"
                      companySlug={companySlug}
                      roomImageUrl={item.group.roomImageUrl}
                      generationId={item.group.generationId}
                      resultImageUrl={item.result!.imageUrl}
                      company={company}
                      onEstimateChange={handleEstimateChange(`${estimateKey}-wall-both`)}
                      compact={hasMultipleEstimates}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Combined total + actions ── */}
          {combinedTotal != null && combinedTotal > 0 && (
            <div className="rounded-2xl overflow-hidden border border-slate-200">
              {/* Combined total price */}
              <div
                className="px-4 py-4 flex items-center justify-between"
                style={{ backgroundColor: "var(--brand-primary)" }}
              >
                <div>
                  <p className="text-xs text-white/70 font-medium">
                    {hasMultipleEstimates ? "Samtals áætlaður kostnaður" : "Áætlaður kostnaður"}
                  </p>
                  <p className="text-xl font-bold text-white mt-0.5">
                    {formatPrice(Math.round(combinedTotal))} kr
                  </p>
                </div>
                {hasMultipleEstimates && (
                  <span className="text-xs text-white/50">
                    {completedCount} {completedCount === 1 ? "vara" : "vörur"}
                  </span>
                )}
              </div>
              {/* Quote buttons */}
              <div className="flex gap-2 p-3 bg-white">
                <button
                  onClick={handleDownloadQuote}
                  disabled={generatingPdf}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                >
                  {generatingPdf ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  Sækja tilboð
                </button>
                <button
                  onClick={() => setShowSendModal(true)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all"
                >
                  <Send className="w-4 h-4" />
                  Senda
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {failedCount > 0 && allDone && (
        <div className="bg-red-50 rounded-xl border border-red-200 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-700">
                {failedCount === totalCount
                  ? "Allar myndagerðir mistókust"
                  : `${failedCount} af ${totalCount} myndagerðum mistókust`
                }
              </p>
              {errorMessages.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {errorMessages.map((msg, i) => (
                    <p key={i} className="text-xs text-red-500">{msg}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Button
            onClick={onReset}
            variant="outline"
            size="sm"
            className="w-full h-8 text-xs border-red-200 text-red-600 hover:bg-red-100"
          >
            <RotateCcw className="w-3 h-3 mr-1.5" /> Reyna aftur
          </Button>
        </div>
      )}

      {/* Cinema Mode Lightbox */}
      {cinemaOpen && activeImage && activeRoomImage && (
        <CinemaMode
          activeImage={activeImage}
          activeRoomImage={activeRoomImage}
          showComparison={showComparison}
          setShowComparison={setShowComparison}
          productName={activeItem?.group.product.name || ""}
          surfaceType={activeItem?.group.surfaceType || "floor"}
          counter={`${currentPosInCompleted + 1} / ${completedIndices.length}`}
          hasMultiple={completedIndices.length > 1}
          onPrev={goPrev}
          onNext={goNext}
          onClose={() => setCinemaOpen(false)}
          onDownload={downloadCurrent}
        />
      )}

      {/* Send Quote Modal */}
      {showSendModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowSendModal(false); setSendError(""); setSendSuccess(false); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-slate-500" />
                <h3 className="text-base font-bold text-slate-900">Senda tilbo\u00F0</h3>
              </div>
              <button
                onClick={() => { setShowSendModal(false); setSendError(""); setSendSuccess(false); }}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {sendSuccess ? (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-base font-semibold text-slate-900">Tilbo\u00F0 sent!</p>
                  <p className="text-sm text-slate-400 mt-1">PDF skjali\u00F0 hefur veri\u00F0 sent \u00E1 {sendEmail}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">
                    Tilbo\u00F0i\u00F0 ver\u00F0ur sent sem PDF skjal \u00E1 netfangi\u00F0 sem \u00FE\u00FA sl\u00E6r inn.
                  </p>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Netfang</label>
                    <input
                      type="email"
                      placeholder="netfang@dæmi.is"
                      value={sendEmail}
                      onChange={(e) => setSendEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSendQuote(); }}
                      className="w-full mt-1.5 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/30 focus:border-[var(--brand-primary)]"
                      autoFocus
                    />
                  </div>
                  {sendError && (
                    <p className="text-xs text-red-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {sendError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {!sendSuccess && (
              <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
                <button
                  onClick={() => { setShowSendModal(false); setSendError(""); }}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  H\u00E6tta vi\u00F0
                </button>
                <button
                  onClick={handleSendQuote}
                  disabled={sendingEmail || !sendEmail}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand-primary)" }}
                >
                  {sendingEmail ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Senda tilbo\u00F0
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
