"use client";

export default function LandingPage() {
  return (
    <div className="fixed inset-0 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-center py-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
          <span className="text-xl font-semibold tracking-tight text-slate-900">snið</span>
        </div>
      </div>

      {/* Center content */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-xl text-slate-400 font-light tracking-wide">
          Sjónræn sýn á efnisval
        </h1>
        <a
          href="mailto:info@snid.is"
          className="mt-8 text-sm text-slate-400 hover:text-slate-900 transition-colors underline underline-offset-4"
        >
          Contact us
        </a>
      </div>

      {/* Bottom */}
      <div className="flex flex-col items-center gap-4 pb-8">
        <p className="text-[11px] text-slate-300 uppercase tracking-[0.2em]">
          Trusted by
        </p>
        <span className="text-lg font-semibold text-slate-200">Álfaborg</span>
      </div>
    </div>
  );
}
