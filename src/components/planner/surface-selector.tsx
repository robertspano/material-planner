"use client";

import { Button } from "@/components/ui/button";

export type SurfaceSelection = "floor" | "wall" | "both";

interface SurfaceSelectorProps {
  selected: SurfaceSelection | null;
  onSelect: (surface: SurfaceSelection) => void;
  onContinue: () => void;
  roomImageUrl: string;
  roomCount: number;
}

export function SurfaceSelector({ selected, onSelect, onContinue, roomImageUrl, roomCount }: SurfaceSelectorProps) {
  const options: { value: SurfaceSelection; label: string }[] = [
    { value: "floor", label: "Gólf" },
    { value: "wall", label: "Veggir" },
    { value: "both", label: "Gólf og Veggir" },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden border border-slate-200">
        <img src={roomImageUrl} alt="Room" className="w-full max-h-[400px] object-contain bg-black" />
      </div>

      <div className="flex flex-col items-center gap-3">
        <h3 className="text-sm font-medium text-slate-500">Veldu flöt:</h3>
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
          {options.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onSelect(value)}
              className={`px-4 sm:px-5 py-2.5 sm:py-3 rounded-xl font-medium text-sm transition-all ${
                selected === value
                  ? "text-white shadow-lg"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
              style={selected === value ? { backgroundColor: "var(--brand-primary)" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {roomCount > 1 && selected && (
          <p className="text-xs text-slate-400">
            Þetta gildir um allar {roomCount} myndir
          </p>
        )}
      </div>

      <Button
        onClick={onContinue}
        disabled={!selected}
        className="w-full py-5 text-white rounded-xl"
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        Halda áfram
      </Button>
    </div>
  );
}
