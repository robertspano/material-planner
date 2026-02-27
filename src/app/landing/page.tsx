"use client";

import Image from "next/image";

export default function LandingPage() {
  return (
    <div className="fixed inset-0 bg-white flex flex-col">
      {/* Logo top-left */}
      <div className="px-8 pt-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">S</span>
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-900">snið</span>
        </div>
      </div>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-16">
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-slate-900 text-center leading-tight max-w-2xl">
          Sjónræn sýn á efnisval
        </h1>
        <p className="mt-6 text-base sm:text-lg text-slate-400 text-center max-w-lg leading-relaxed">
          Gervigreind sem sýnir viðskiptavinum þínum hvernig efni líta út í raunverulegum rýmum.
        </p>
        <a
          href="mailto:info@snid.is"
          className="mt-8 text-sm text-slate-400 hover:text-slate-900 transition-colors"
        >
          info@snid.is
        </a>
      </div>

      {/* Trusted by - bottom */}
      <div className="flex flex-col items-center gap-6 pb-10">
        <p className="text-[11px] text-slate-300 uppercase tracking-[0.25em]">
          Trusted by
        </p>
        <div className="flex items-center gap-12">
          <Image
            src="https://res.cloudinary.com/dgrig52h7/image/upload/v1772054190/company-logos/mxjcs8hikmbee0qoefle.svg"
            alt="Álfaborg"
            width={120}
            height={40}
            className="opacity-30 hover:opacity-60 transition-opacity"
          />
        </div>
      </div>
    </div>
  );
}
