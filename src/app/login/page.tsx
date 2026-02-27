"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paintbrush } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Login failed");
        return;
      }

      const data = await res.json();
      if (data.admin.role === "super_admin") {
        router.push("/super");
      } else {
        router.push("/admin");
      }
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-sky-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 flex items-center justify-center">
            <Paintbrush className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Material Planner</h1>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-slate-900 mb-1">Innskráning</h2>
          <p className="text-sm text-slate-500 mb-6">Skráðu þig inn til að stjórna vörulistanum</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Netfang</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@fyrirtæki.is"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="password">Lykilorð</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-1"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Skrái inn..." : "Skrá inn"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
