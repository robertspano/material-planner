"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download, RotateCcw, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GenerationResult {
  id: string;
  imageUrl: string;
  createdAt: string;
}

interface GenerationData {
  id: string;
  status: string;
  errorMessage: string | null;
  results: GenerationResult[];
}

interface ResultGalleryProps {
  generationId: string;
  companySlug: string;
  onReset: () => void;
}

export function ResultGallery({ generationId, companySlug, onReset }: ResultGalleryProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const { data: generation } = useQuery<GenerationData>({
    queryKey: [`/api/planner/generation/${generationId}?company=${companySlug}`],
    refetchInterval: (query) => {
      const data = query.state.data as GenerationData | undefined;
      if (!data) return 2000;
      if (data.status === "completed" || data.status === "failed") return false;
      return 2000;
    },
  });

  const status = generation?.status || "pending";

  if (status === "pending" || status === "segmenting" || status === "generating") {
    return (
      <div className="dark:bg-slate-800/60 bg-white rounded-2xl border dark:border-slate-700/50 border-slate-200 p-12 text-center">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4" style={{ color: "var(--brand-primary)" }} />
        <h3 className="text-lg font-semibold dark:text-white text-slate-900 mb-2">
          {status === "pending" ? "Starting..." : status === "segmenting" ? "Analyzing room surfaces..." : "Generating visualization..."}
        </h3>
        <p className="text-sm dark:text-slate-400 text-slate-500">
          This usually takes 15-30 seconds
        </p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="dark:bg-slate-800/60 bg-white rounded-2xl border dark:border-slate-700/50 border-slate-200 p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
          <ImageIcon className="w-8 h-8 text-red-400" />
        </div>
        <h3 className="text-lg font-semibold dark:text-white text-slate-900 mb-2">Generation Failed</h3>
        <p className="text-sm dark:text-slate-400 text-slate-500 mb-4">
          {generation?.errorMessage || "Something went wrong. Please try again."}
        </p>
        <Button onClick={onReset} variant="outline">
          <RotateCcw className="w-4 h-4 mr-2" /> Try Again
        </Button>
      </div>
    );
  }

  const results = generation?.results || [];

  if (results.length === 0) {
    return (
      <div className="dark:bg-slate-800/60 bg-white rounded-2xl border dark:border-slate-700/50 border-slate-200 p-12 text-center">
        <p className="dark:text-slate-400 text-slate-500">No results generated</p>
        <Button onClick={onReset} variant="outline" className="mt-4">
          <RotateCcw className="w-4 h-4 mr-2" /> Try Again
        </Button>
      </div>
    );
  }

  const currentResult = results[selectedIdx] || results[0];

  return (
    <div className="space-y-4">
      {/* Main Result Image */}
      <div className="rounded-2xl overflow-hidden border dark:border-slate-700/50 border-slate-200">
        <img
          src={currentResult.imageUrl}
          alt="Generated visualization"
          className="w-full max-h-[500px] object-contain bg-black"
        />
      </div>

      {/* Result Thumbnails (if multiple) */}
      {results.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {results.map((result, idx) => (
            <button
              key={result.id}
              onClick={() => setSelectedIdx(idx)}
              className={`flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all ${
                idx === selectedIdx
                  ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30"
                  : "dark:border-slate-700 border-slate-200"
              }`}
            >
              <img src={result.imageUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <a
          href={currentResult.imageUrl}
          download
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1"
        >
          <Button className="w-full text-white" style={{ backgroundColor: "var(--brand-primary)" }}>
            <Download className="w-4 h-4 mr-2" /> Download
          </Button>
        </a>
        <Button onClick={onReset} variant="outline" className="flex-1">
          <RotateCcw className="w-4 h-4 mr-2" /> New Visualization
        </Button>
      </div>
    </div>
  );
}
