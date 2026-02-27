"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Switch removed — using Active/Lokað button instead
import {
  Building2, Package, ImageIcon, Loader2, Plus, X, Search, Layers,
  Users, Settings, Eye, EyeOff, ChevronDown, Save, Upload, Key, Mail, User, Pencil, Globe, Trash2, AlertTriangle,
  Check, AlertCircle
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { AdminStats } from "@/types";

interface CompanyWithCounts {
  id: string;
  name: string;
  slug: string;
  kennitala: string | null;
  logoUrl: string | null;
  logoIsLight: boolean;
  primaryColor: string;
  secondaryColor: string;
  isActive: boolean;
  plan: string;
  monthlyGenerationLimit: number;
  generationsUsed: number;
  createdAt: string;
  _count: { products: number; generations: number; admins: number };
}

interface AdminEntry {
  id: string;
  email: string;
  name: string;
  role: string;
  plainPassword: string | null;
  companyId: string | null;
  company?: { id: string; name: string; slug: string } | null;
}

function CompanyCard({ company, admins, onUpdate, onToggle, onDelete }: {
  company: CompanyWithCounts;
  admins: AdminEntry[];
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editName, setEditName] = useState(company.name);
  const [editKennitala, setEditKennitala] = useState(company.kennitala || "");
  const [editPrimary, setEditPrimary] = useState(company.primaryColor);
  const [editSecondary, setEditSecondary] = useState(company.secondaryColor);
  const [editLogoUrl, setEditLogoUrl] = useState(company.logoUrl || "");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPasswordFor, setShowPasswordFor] = useState<string | null>(null);

  // Admin editing
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [savingAdmin, setSavingAdmin] = useState(false);

  useEffect(() => {
    setEditName(company.name);
    setEditKennitala(company.kennitala || "");
    setEditPrimary(company.primaryColor);
    setEditSecondary(company.secondaryColor);
    setEditLogoUrl(company.logoUrl || "");
  }, [company]);

  const hasChanges =
    editName !== company.name ||
    editKennitala !== (company.kennitala || "") ||
    editPrimary !== company.primaryColor ||
    editSecondary !== company.secondaryColor ||
    editLogoUrl !== (company.logoUrl || "");

  const handleSave = () => {
    setSaving(true);
    onUpdate(company.id, {
      name: editName,
      kennitala: editKennitala || null,
      primaryColor: editPrimary,
      secondaryColor: editSecondary,
      logoUrl: editLogoUrl || null,
    });
    setTimeout(() => setSaving(false), 500);
  };

  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "company-logos");
      const res = await fetch("/api/super/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setEditLogoUrl(url);
    } catch (err) {
      console.error("Logo upload error:", err);
    } finally {
      setUploadingLogo(false);
    }
  };

  const startEditAdmin = (a: AdminEntry) => {
    setEditingAdminId(a.id);
    setAdminName(a.name);
    setAdminEmail(a.email);
    setAdminPassword(a.plainPassword || "");
  };

  const handleSaveAdmin = async () => {
    if (!editingAdminId) return;
    setSavingAdmin(true);
    try {
      const data: Record<string, string> = {};
      const original = admins.find(a => a.id === editingAdminId);
      if (adminName !== original?.name) data.name = adminName;
      if (adminEmail !== original?.email) data.email = adminEmail;
      if (adminPassword && adminPassword !== (original?.plainPassword || "")) data.password = adminPassword;
      if (Object.keys(data).length > 0) {
        await apiRequest("PATCH", `/api/super/admins/${editingAdminId}`, data);
        queryClient.invalidateQueries({ queryKey: ["/api/super/admins"] });
      }
      setEditingAdminId(null);
    } catch (err) {
      console.error("Save admin error:", err);
    } finally {
      setSavingAdmin(false);
    }
  };

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 overflow-hidden transition-opacity ${!company.isActive ? "opacity-60" : ""}`}
    >
      {/* Header row — brand color strip */}
      <div
        className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer rounded-t-xl"
        style={{ backgroundColor: company.primaryColor }}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Logo / icon */}
          {company.logoUrl ? (
            <img src={company.logoUrl} alt={company.name} className="h-7 max-w-[120px] object-contain flex-shrink-0" />
          ) : (
            <h3 className="font-semibold text-white truncate">{company.name}</h3>
          )}
          {company.kennitala && (
            <p className="text-xs text-white/50 font-mono">kt. {company.kennitala}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onToggle(company.id, !company.isActive)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              company.isActive
                ? "bg-white/15 text-emerald-300 hover:bg-white/25"
                : "bg-white/15 text-red-300 hover:bg-white/25"
            }`}
          >
            {company.isActive ? "Virkt" : "Lokað"}
          </button>
          <button onClick={() => setExpanded(!expanded)}
            className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/70 hover:bg-white/20">
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* Stats row - always visible */}
      <div className="px-4 pt-3 pb-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-blue-50/80 px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <Package className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-2xl font-bold text-blue-600 leading-none">{company._count.products}</span>
          </div>
          <p className="text-[10px] font-medium text-blue-500/70 uppercase tracking-wider">V&ouml;rur</p>
        </div>
        <div className="rounded-xl bg-orange-50/80 px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <ImageIcon className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-2xl font-bold text-orange-600 leading-none">{company._count.generations}</span>
          </div>
          <p className="text-[10px] font-medium text-orange-500/70 uppercase tracking-wider">Myndir</p>
        </div>
        <div className="rounded-xl bg-emerald-50/80 px-3 py-2.5 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-0.5">
            <Layers className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-2xl font-bold text-emerald-600 leading-none">{company.generationsUsed}</span>
          </div>
          <p className="text-[10px] font-medium text-emerald-500/70 uppercase tracking-wider">Generates</p>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div className="border-t border-slate-200 p-4 space-y-5">
          {/* Quick links */}
          <div className="flex gap-2">
            <a href={`/admin?company=${company.slug}`} className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-700 hover:opacity-80 transition-opacity">
              <Settings className="w-4 h-4" /> Stjórnborð
            </a>
            <a href={`/super/products/${company.id}`} className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-700 hover:opacity-80 transition-opacity">
              <Package className="w-4 h-4" /> Vörur
            </a>
            <a href={`/?company=${company.slug}`} target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-slate-100 text-sm text-slate-700 hover:opacity-80 transition-opacity">
              <Eye className="w-4 h-4" /> Planner
            </a>
          </div>

          {/* Admins section with edit capability */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Aðgangar</p>
            <div className="space-y-2">
              {admins.map((a) => (
                <div key={a.id}>
                  {editingAdminId === a.id ? (
                    /* Editing admin */
                    <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[11px]">Nafn</Label>
                          <div className="relative mt-0.5">
                            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} className="h-8 text-xs pl-8" />
                          </div>
                        </div>
                        <div>
                          <Label className="text-[11px]">Netfang</Label>
                          <div className="relative mt-0.5">
                            <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                            <Input value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="h-8 text-xs pl-8" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-[11px]">Lykilorð (skilja autt ef óbreytt)</Label>
                        <div className="relative mt-0.5">
                          <Key className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <Input type="text" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="••••••••" className="h-8 text-xs pl-8 font-mono" />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button onClick={handleSaveAdmin} disabled={savingAdmin} size="sm" className="bg-purple-600 hover:bg-purple-700 text-white h-7 text-xs px-3">
                          {savingAdmin ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Save className="w-3 h-3 mr-1" /> Vista</>}
                        </Button>
                        <Button onClick={() => setEditingAdminId(null)} variant="ghost" size="sm" className="h-7 text-xs px-3">
                          Hætta við
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Viewing admin */
                    <div className="bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ backgroundColor: company.primaryColor }}>
                            {a.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-900">{a.name}</p>
                            <p className="text-xs text-slate-500">{a.email}</p>
                          </div>
                        </div>
                        <button onClick={() => startEditAdmin(a)} className="w-7 h-7 rounded-lg bg-slate-200 flex items-center justify-center text-slate-500 hover:opacity-80" title="Breyta">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {a.plainPassword && (
                        <div className="flex items-center gap-2 mt-1.5 ml-[38px]">
                          <Key className="w-3 h-3 text-slate-400 flex-shrink-0" />
                          <span className="text-xs font-mono text-slate-500">
                            {showPasswordFor === a.id ? a.plainPassword : "••••••••"}
                          </span>
                          <button
                            onClick={() => setShowPasswordFor(showPasswordFor === a.id ? null : a.id)}
                            className="text-slate-400 hover:text-slate-600 transition-colors"
                            title={showPasswordFor === a.id ? "Fela lykilorð" : "Sýna lykilorð"}
                          >
                            {showPasswordFor === a.id ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Company settings */}
          <div className="pt-2 border-t border-slate-200 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Stillingar fyrirtækis</p>

            {/* Logo */}
            <div>
              <Label className="text-xs">Logo</Label>
              <div className="flex items-center gap-3 mt-1">
                {uploadingLogo ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : editLogoUrl ? (
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 px-3 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
                      style={{ backgroundColor: company.logoIsLight ? company.primaryColor : "#f1f5f9" }}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      <img src={editLogoUrl} alt="Logo" className="h-5 max-w-[120px] object-contain" />
                    </div>
                    <button onClick={() => setEditLogoUrl("")} className="text-red-400 hover:text-red-300" title="Fjarlægja logo">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="text-xs text-slate-500 bg-slate-100 px-3 py-2 rounded-lg hover:opacity-80 flex items-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5" /> Hlaða upp logo
                  </button>
                )}
                <input
                  ref={logoInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleLogoUpload(file);
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Nafn</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-1 h-9 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Kennitala</Label>
                <Input
                  value={editKennitala}
                  onChange={(e) => setEditKennitala(e.target.value)}
                  placeholder="000000-0000"
                  className="mt-1 h-9 text-sm font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Aðallitur</Label>
                <div className="flex gap-2 mt-1">
                  <input type="color" value={editPrimary} onChange={(e) => setEditPrimary(e.target.value)} className="w-9 h-9 rounded border cursor-pointer" />
                  <Input value={editPrimary} onChange={(e) => setEditPrimary(e.target.value)} className="font-mono text-xs flex-1 h-9" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Aukalitur</Label>
                <div className="flex gap-2 mt-1">
                  <input type="color" value={editSecondary} onChange={(e) => setEditSecondary(e.target.value)} className="w-9 h-9 rounded border cursor-pointer" />
                  <Input value={editSecondary} onChange={(e) => setEditSecondary(e.target.value)} className="font-mono text-xs flex-1 h-9" />
                </div>
              </div>
            </div>
            {hasChanges && (
              <Button onClick={handleSave} disabled={saving} className="w-full bg-purple-600 hover:bg-purple-700 text-white h-9 text-sm">
                <Save className="w-4 h-4 mr-1.5" />
                {saving ? "Vista..." : "Vista breytingar"}
              </Button>
            )}
          </div>

          {/* Delete company */}
          <div className="pt-2 border-t border-slate-200">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 text-xs text-red-500 hover:text-red-400 transition-colors px-1 py-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Eyða fyrirtæki
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation popup */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Eyða {company.name}?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Þetta eyðir fyrirtækinu, öllum vörum, flokkum, aðgöngum og myndum. Ekki er hægt að afturkalla þetta.
                </p>
              </div>
              <div className="flex gap-3 w-full pt-2">
                <Button
                  onClick={() => setShowDeleteConfirm(false)}
                  variant="ghost"
                  className="flex-1 h-10"
                >
                  Hætta við
                </Button>
                <Button
                  onClick={() => {
                    onDelete(company.id);
                    setShowDeleteConfirm(false);
                  }}
                  className="flex-1 h-10 bg-red-600 hover:bg-red-700 text-white"
                >
                  <Trash2 className="w-4 h-4 mr-1.5" /> Eyða
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperDashboardPage() {
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [cName, setCName] = useState("");
  const [cKennitala, setCKennitala] = useState("");
  const [cPrimary, setCPrimary] = useState("#2e7cff");
  const [cSecondary, setCSecondary] = useState("#1e293b");
  const [cLogoUrl, setCLogoUrl] = useState("");
  const [cLogoIsLight, setCLogoIsLight] = useState(false);
  const [uploadingCreateLogo, setUploadingCreateLogo] = useState(false);
  const createLogoRef = useRef<HTMLInputElement>(null);
  const [aName, setAName] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aPassword, setAPassword] = useState("");
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState("");
  const [scrapeFeedback, setScrapeFeedback] = useState<Record<string, { found: boolean; confidence?: string; message: string }> | null>(null);

  const handleScrape = async () => {
    if (!scrapeUrl.trim()) return;
    setScraping(true);
    setScrapeError("");
    setScrapeFeedback(null);
    try {
      const res = await fetch("/api/super/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scrapeUrl }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Gat ekki sótt vefsíðu");
      }
      const data = await res.json();
      if (data.name) setCName(data.name);
      if (data.kennitala) setCKennitala(data.kennitala);
      if (data.primaryColor) setCPrimary(data.primaryColor);
      if (data.secondaryColor) setCSecondary(data.secondaryColor);
      // Set logo light flag from scraper analysis
      setCLogoIsLight(data.logoIsLight || false);
      // Handle logo: if SVG was found, upload it to get a real URL
      if (data.logoSvg) {
        try {
          const svgBlob = new Blob([data.logoSvg], { type: "image/svg+xml" });
          const file = new File([svgBlob], "logo.svg", { type: "image/svg+xml" });
          const fd = new FormData();
          fd.append("file", file);
          fd.append("folder", "company-logos");
          const uploadRes = await fetch("/api/super/upload", { method: "POST", body: fd, credentials: "include" });
          if (uploadRes.ok) {
            const { url } = await uploadRes.json();
            setCLogoUrl(url);
          }
        } catch {
          // If SVG upload fails, use data URI as fallback
          if (data.logoUrl) setCLogoUrl(data.logoUrl);
        }
      } else if (data.logoUrl) {
        setCLogoUrl(data.logoUrl);
      }
      // Set feedback from scraper
      if (data.feedback) {
        setScrapeFeedback(data.feedback);
      }
    } catch (err: unknown) {
      setScrapeError(err instanceof Error ? err.message : "Villa við að sækja vefsíðu");
    } finally {
      setScraping(false);
    }
  };

  const { data: stats } = useQuery<AdminStats>({ queryKey: ["/api/super/stats"] });
  const { data: companies = [], isLoading } = useQuery<CompanyWithCounts[]>({ queryKey: ["/api/super/companies"] });
  const { data: admins = [] } = useQuery<AdminEntry[]>({ queryKey: ["/api/super/admins"] });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiRequest("POST", "/api/super/companies", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/super/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/super/admins"] });
      setShowCreate(false);
      setCName(""); setCKennitala(""); setCPrimary("#2e7cff"); setCSecondary("#1e293b"); setCLogoUrl(""); setCLogoIsLight(false);
      setAName(""); setAEmail(""); setAPassword(""); setScrapeUrl(""); setScrapeError(""); setScrapeFeedback(null);
    },
  });

  const updateCompanyMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Record<string, unknown>) => apiRequest("PATCH", `/api/super/companies/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/super/companies"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/super/companies/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/super/companies"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/super/companies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/super/companies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/super/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/super/admins"] });
    },
  });

  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.slug.toLowerCase().includes(search.toLowerCase()) ||
    (c.kennitala && c.kennitala.includes(search))
  );

  const getCompanyAdmins = (companyId: string) => admins.filter((a) => a.companyId === companyId);

  const autoSlug = cName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const handleCreateLogoUpload = async (file: File) => {
    setUploadingCreateLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "company-logos");
      const res = await fetch("/api/super/upload", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
      setCLogoUrl(url);
    } catch (err) {
      console.error("Logo upload error:", err);
    } finally {
      setUploadingCreateLogo(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{stats?.totalCompanies || 0}</p>
            <p className="text-xs text-slate-500">Fyrirtæki</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Package className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{stats?.totalProducts || 0}</p>
            <p className="text-xs text-slate-500">Vörur</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Layers className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{stats?.totalGenerates || 0}</p>
            <p className="text-xs text-slate-500">Generates</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-900">{stats?.totalGenerations || 0}</p>
            <p className="text-xs text-slate-500">Myndir</p>
          </div>
        </div>
      </div>

      {/* Companies */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-slate-900">Fyrirtæki</h2>
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Leita..." className="pl-9 h-9 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Button onClick={() => setShowCreate(true)} className="bg-purple-600 hover:bg-purple-700 text-white h-9">
              <Plus className="w-4 h-4 mr-1" /> Fyrirtæki
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div>
        ) : (
          <div className="space-y-6">
            {filtered.map((c) => (
              <CompanyCard
                key={c.id}
                company={c}
                admins={getCompanyAdmins(c.id)}
                onUpdate={(id, data) => updateCompanyMutation.mutate({ id, ...data })}
                onToggle={(id, isActive) => toggleMutation.mutate({ id, isActive })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Company + Admin Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Nýtt fyrirtæki</h2>
              <button onClick={() => setShowCreate(false)} className=""><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              {/* URL Scraper */}
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                <Label className="text-xs flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5" /> Sækja af vefsíðu
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={scrapeUrl}
                    onChange={(e) => setScrapeUrl(e.target.value)}
                    placeholder="byko.is"
                    className="h-9 text-sm flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") handleScrape(); }}
                  />
                  <Button
                    onClick={handleScrape}
                    disabled={scraping || !scrapeUrl.trim()}
                    className="bg-purple-600 hover:bg-purple-700 text-white h-9 px-4 text-sm"
                  >
                    {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sækja"}
                  </Button>
                </div>
                {scrapeError && <p className="text-xs text-red-400">{scrapeError}</p>}
                {!scrapeFeedback && <p className="text-[10px] text-slate-400">Sláðu inn vefslóð og við sækjum nafn, logo, liti og kennitölu</p>}
                {scrapeFeedback && (
                  <div className="space-y-1 pt-1">
                    {Object.entries(scrapeFeedback).map(([key, fb]) => {
                      const labels: Record<string, string> = {
                        name: "Nafn", logo: "Logo", kennitala: "Kennitala",
                        primaryColor: "Aðallitur", secondaryColor: "Aukalitur",
                      };
                      const confidence = (fb as { confidence?: string }).confidence || (fb.found ? "medium" : "none");
                      const colorClass = confidence === "high"
                        ? "text-emerald-600"
                        : confidence === "medium"
                        ? "text-amber-600"
                        : confidence === "low"
                        ? "text-orange-600"
                        : "text-slate-400";
                      const icon = confidence === "high"
                        ? <Check className="w-3 h-3 flex-shrink-0" />
                        : confidence === "none"
                        ? <X className="w-3 h-3 flex-shrink-0" />
                        : <AlertCircle className="w-3 h-3 flex-shrink-0" />;
                      return (
                        <div key={key} className={`flex items-center gap-1.5 text-[11px] ${colorClass}`}>
                          {icon}
                          <span className="font-medium">{labels[key] || key}:</span>
                          <span className="opacity-80">{fb.message}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Logo */}
              <div>
                <Label className="text-xs">Logo</Label>
                <div className="flex items-center gap-3 mt-1">
                  {uploadingCreateLogo ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : cLogoUrl ? (
                    <div className="flex items-center gap-3">
                      <div
                        className="h-10 px-3 rounded-lg flex items-center justify-center cursor-pointer hover:opacity-70 transition-opacity"
                        style={{ backgroundColor: cLogoIsLight ? cPrimary : "#f1f5f9" }}
                        onClick={() => createLogoRef.current?.click()}
                      >
                        <img src={cLogoUrl} alt="Logo" className="h-6 max-w-[140px] object-contain" />
                      </div>
                      <button onClick={() => setCLogoUrl("")} className="text-red-400 hover:text-red-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => createLogoRef.current?.click()}
                      className="text-xs text-slate-500 bg-slate-100 px-3 py-2 rounded-lg hover:opacity-80 flex items-center gap-2"
                    >
                      <Upload className="w-3.5 h-3.5" /> Hlaða upp logo
                    </button>
                  )}
                  <input
                    ref={createLogoRef}
                    type="file"
                    className="hidden"
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleCreateLogoUpload(file);
                    }}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Nafn fyrirtækis</Label>
                <Input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Byko" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Kennitala</Label>
                <Input value={cKennitala} onChange={(e) => setCKennitala(e.target.value)} placeholder="000000-0000" className="mt-1 font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Aðallitur</Label>
                  <div className="flex gap-2 mt-1">
                    <input type="color" value={cPrimary} onChange={(e) => setCPrimary(e.target.value)} className="w-9 h-9 rounded border cursor-pointer" />
                    <Input value={cPrimary} onChange={(e) => setCPrimary(e.target.value)} className="font-mono text-xs flex-1" />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Aukalitur</Label>
                  <div className="flex gap-2 mt-1">
                    <input type="color" value={cSecondary} onChange={(e) => setCSecondary(e.target.value)} className="w-9 h-9 rounded border cursor-pointer" />
                    <Input value={cSecondary} onChange={(e) => setCSecondary(e.target.value)} className="font-mono text-xs flex-1" />
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3 pt-2">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Admin aðgangur</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <div>
                <Label>Nafn admin</Label>
                <Input value={aName} onChange={(e) => setAName(e.target.value)} placeholder="Jón Jónsson" className="mt-1" />
              </div>
              <div>
                <Label>Netfang</Label>
                <Input type="email" value={aEmail} onChange={(e) => setAEmail(e.target.value)} placeholder="jon@fyrirtaeki.is" className="mt-1" />
              </div>
              <div>
                <Label>Lykilorð</Label>
                <Input type="password" value={aPassword} onChange={(e) => setAPassword(e.target.value)} placeholder="Lágmark 8 stafir" className="mt-1" />
              </div>

              <Button
                onClick={() => createMutation.mutate({
                  name: cName,
                  slug: autoSlug,
                  kennitala: cKennitala || undefined,
                  primaryColor: cPrimary,
                  secondaryColor: cSecondary,
                  logoUrl: cLogoUrl || undefined,
                  logoIsLight: cLogoIsLight,
                  adminName: aName,
                  adminEmail: aEmail,
                  adminPassword: aPassword,
                })}
                disabled={!cName || createMutation.isPending}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white"
              >
                {createMutation.isPending ? "Bý til..." : "Búa til fyrirtæki"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
