"use client";

export default function LandingPage() {
  return (
    <div className="h-screen w-screen bg-white flex flex-col items-center justify-center overflow-hidden">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-12">
        <div className="w-10 h-10 bg-slate-900 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-lg">S</span>
        </div>
        <span className="text-2xl font-semibold tracking-tight text-slate-900">snið</span>
      </div>

      {/* Tagline */}
      <h1 className="text-xl sm:text-2xl text-slate-400 font-light tracking-wide text-center max-w-md">
        Sjónræn sýn á efnisval
      </h1>

      {/* Contact */}
      <a
        href="mailto:info@snid.is"
        className="mt-10 text-sm text-slate-400 hover:text-slate-900 transition-colors underline underline-offset-4"
      >
        Contact us
      </a>

      {/* Trusted By */}
      <div className="absolute bottom-12 flex flex-col items-center gap-6">
        <p className="text-[11px] text-slate-300 uppercase tracking-[0.2em]">
          Trusted by
        </p>
        <div className="flex items-center gap-10">
          <span className="text-lg font-semibold text-slate-200">Álfaborg</span>
        </div>
      </div>
    </div>
  );
}
