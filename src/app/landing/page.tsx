"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

const PASSWORD = "2404";

export default function LandingPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem("snid-landing-unlocked");
      if (saved === "true") setUnlocked(true);
    }
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (input === PASSWORD) {
      setUnlocked(true);
      sessionStorage.setItem("snid-landing-unlocked", "true");
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  }

  if (!unlocked) {
    return (
      <div className={`fixed inset-0 bg-white flex flex-col items-center justify-center ${inter.className}`}>
        <div className="flex items-center gap-2 mb-10">
          <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">S</span>
          </div>
          <span className="text-base font-medium tracking-tight text-slate-900">snið</span>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4">
          <input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Lykilorð"
            autoFocus
            className={`w-48 px-4 py-2 text-sm text-center bg-white border rounded-lg outline-none transition-colors appearance-none ${
              error ? "border-red-400" : "border-slate-200 focus:border-slate-400"
            }`}
            style={{ WebkitAppearance: "none", color: "#94a3b8", backgroundColor: "#ffffff", caretColor: "#94a3b8", WebkitTextSecurity: "disc" } as React.CSSProperties}
          />
          <button
            type="submit"
            className="text-sm text-slate-900 hover:text-slate-600 transition-colors underline underline-offset-4"
          >
            Opna
          </button>
        </form>
      </div>
    );
  }

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

      {/* Main content - centered, nudged up */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-44">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-medium text-slate-900 text-center leading-[1.1] max-w-2xl tracking-[-0.02em]">
          Velkomin til Snið
        </h1>
        <p className="mt-6 text-lg sm:text-xl font-normal text-slate-900 text-center max-w-3xl whitespace-nowrap tracking-[-0.01em]">
          Sýndu viðskiptavinum þínum hvernig efni líta út á gólfi og veggjum í þeirra eigin rýmum.
        </p>
        <a
          href="mailto:info@snid.is"
          className="mt-12 text-base font-bold text-slate-900 hover:text-slate-600 transition-colors underline underline-offset-4"
        >
          Hafðu samband
        </a>
      </div>

      {/* Treysta okkur */}
      <div className="flex flex-col items-center gap-8 pb-12 -mt-40">
        <p className="text-[11px] text-slate-900 uppercase tracking-[0.25em] font-bold">
          Treysta okkur
        </p>
        <div className="flex items-center gap-12">
          <Image
            src="https://res.cloudinary.com/dgrig52h7/image/upload/v1772054190/company-logos/mxjcs8hikmbee0qoefle.svg"
            alt="Álfaborg"
            width={180}
            height={56}
            className="brightness-0"
          />
        </div>
      </div>
    </div>
  );
}
