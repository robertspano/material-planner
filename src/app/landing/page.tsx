"use client";

import { ArrowRight, Mail, Eye, Palette, BarChart3 } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <span className="text-xl font-semibold tracking-tight">snið</span>
          </div>
          <a
            href="mailto:info@snid.is"
            className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            Hafðu samband
          </a>
        </div>
      </header>

      {/* Hero */}
      <main className="pt-32 pb-20">
        <div className="max-w-5xl mx-auto px-6">
          <div className="max-w-3xl">
            <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1] text-slate-900">
              Sjónræn sýn á{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-600 to-slate-400">
                efnisval
              </span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-500 max-w-xl leading-relaxed">
              Sýndu viðskiptavinum þínum hvernig flísar, parket og vínil líta út
              í raunverulegum herbergjum — með gervigreind.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a
                href="mailto:info@snid.is"
                className="inline-flex items-center gap-2 bg-slate-900 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                <Mail className="w-4 h-4" />
                Hafðu samband
              </a>
              <a
                href="https://alfaborg.snid.is"
                className="inline-flex items-center gap-2 border border-slate-200 text-slate-700 px-6 py-3 rounded-full text-sm font-medium hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Sjá demo
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Features */}
          <div className="mt-24 grid grid-cols-1 sm:grid-cols-3 gap-8">
            <div className="space-y-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Eye className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="font-semibold text-slate-900">AI sjónræn sýn</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Hlaðið upp mynd af herbergi og sjáið hvernig efnið lítur út á
                gólfi eða veggjum á nokkrum sekúndum.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Palette className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="font-semibold text-slate-900">Ykkar vörulisti</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Viðskiptavinir velja beint úr ykkar vörulista — flísar, parket,
                vínil og lagnarmynstur.
              </p>
            </div>
            <div className="space-y-3">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="font-semibold text-slate-900">Ykkar vörumerki</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Sérsniðin upplifun með ykkar litum, lógói og vörum á eigin
                subdomain.
              </p>
            </div>
          </div>

          {/* Trusted By */}
          <div className="mt-32">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-widest text-center">
              Treysta okkur
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-12">
              <div className="text-2xl font-bold text-slate-300 hover:text-slate-400 transition-colors">
                Álfaborg
              </div>
              <div className="text-2xl font-bold text-slate-300 hover:text-slate-400 transition-colors">
                Byko
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-slate-900 rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">S</span>
            </div>
            <span className="text-sm font-medium text-slate-400">snið</span>
          </div>
          <a
            href="mailto:info@snid.is"
            className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            info@snid.is
          </a>
        </div>
      </footer>
    </div>
  );
}
