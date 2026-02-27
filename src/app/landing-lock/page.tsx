"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
});

export default function LandingLockPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);

    try {
      const res = await fetch("/api/landing-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
        credentials: "include",
      });

      if (res.ok) {
        router.replace("/");
      } else {
        setError(true);
        setTimeout(() => setError(false), 1500);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

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
          disabled={loading}
          className={`w-48 px-4 py-2 text-sm text-center bg-white border rounded-lg outline-none transition-colors appearance-none ${
            error ? "border-red-400" : "border-slate-200 focus:border-slate-400"
          }`}
          style={{ WebkitAppearance: "none", color: "#94a3b8", backgroundColor: "#ffffff", caretColor: "#94a3b8", WebkitTextSecurity: "disc" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={loading}
          className="text-sm text-slate-900 hover:text-slate-600 transition-colors underline underline-offset-4"
        >
          {loading ? "..." : "Opna"}
        </button>
      </form>
    </div>
  );
}
