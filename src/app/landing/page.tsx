"use client";

import Image from "next/image";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

export default function LandingPage() {
  return (
    <div className={`fixed inset-0 bg-white flex flex-col ${inter.className}`}>
      {/* Logo centered in header */}
      <div className="flex items-center justify-center pt-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">S</span>
          </div>
          <span className="text-base font-medium tracking-tight text-slate-900">snið</span>
        </div>
      </div>

      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-medium text-slate-900 text-center leading-[1.1] max-w-2xl tracking-[-0.02em]">
          Velkomin til Snið
        </h1>
        <p className="mt-6 text-base sm:text-lg font-normal text-slate-900 text-center max-w-md leading-relaxed tracking-[-0.01em]">
          Gervigreindarverkfæri sem sýnir viðskiptavinum þínum efnisval í raunverulegu rými.
        </p>
        <a
          href="mailto:info@snid.is"
          className="mt-8 text-sm font-normal text-slate-900 hover:text-slate-600 transition-colors underline underline-offset-4"
        >
          Contact us
        </a>
      </div>

      {/* Treysta okkur - near bottom */}
      <div className="flex flex-col items-center gap-5 pb-16">
        <p className="text-[11px] text-slate-900 uppercase tracking-[0.25em] font-medium">
          Treysta okkur
        </p>
        <div className="flex items-center gap-12">
          <Image
            src="https://res.cloudinary.com/dgrig52h7/image/upload/v1772054190/company-logos/mxjcs8hikmbee0qoefle.svg"
            alt="Álfaborg"
            width={160}
            height={50}
            className="brightness-0"
          />
        </div>
      </div>
    </div>
  );
}
