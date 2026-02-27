"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Plus, X, Trash2, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAdminCompany } from "@/components/admin/admin-company-context";

interface CategoryEntry { id: string; name: string; surfaceType: string; sortOrder: number; _count: { products: number }; }

export default function CategoriesPage() {
  const { adminApiUrl, companySlug } = useAdminCompany();
  const { data: company } = useQuery<{ primaryColor: string }>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug,
  });
  const brandColor = company?.primaryColor || "#2e7cff";
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [surfaceType, setSurfaceType] = useState("floor");

  const categoriesUrl = adminApiUrl("/api/admin/categories");

  const { data: categories = [], isLoading } = useQuery<CategoryEntry[]>({ queryKey: [categoriesUrl] });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; surfaceType: string }) => apiRequest("POST", categoriesUrl, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [categoriesUrl] }); setShowCreate(false); setName(""); setSurfaceType("floor"); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", adminApiUrl(`/api/admin/categories/${id}`)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [categoriesUrl] }),
  });

  const surfaceLabel = (t: string) => t === "floor" ? "Gólf" : t === "wall" ? "Veggur" : "Bæði";
  const surfaceColor = (t: string) => t === "floor" ? "bg-blue-500/20 text-blue-400" : t === "wall" ? "bg-purple-500/20 text-purple-400" : "bg-green-500/20 text-green-400";

  return (
    <div className="max-w-3xl space-y-4 lg:space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl lg:text-2xl font-bold dark:text-white text-slate-900">Flokkar</h1>
        <Button onClick={() => setShowCreate(true)} className="text-white hover:opacity-90" style={{ backgroundColor: brandColor }}>
          <Plus className="w-4 h-4 mr-2" /> Bæta við
        </Button>
      </div>

      {isLoading ? (
        <div className="p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto dark:text-slate-400" /></div>
      ) : categories.length === 0 ? (
        <div className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-12 text-center">
          <FolderOpen className="w-12 h-12 dark:text-slate-600 text-slate-300 mx-auto mb-3" />
          <p className="dark:text-slate-400">Engir flokkar ennþá</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="dark:bg-slate-800/60 bg-white rounded-xl border dark:border-slate-700/50 border-slate-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderOpen className="w-5 h-5 dark:text-slate-400 text-slate-500" />
                <div>
                  <h3 className="font-medium dark:text-white text-slate-900">{c.name}</h3>
                  <p className="text-xs dark:text-slate-400 text-slate-500">{c._count.products} vörur</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className={`text-xs ${surfaceColor(c.surfaceType)}`}>{surfaceLabel(c.surfaceType)}</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteMutation.mutate(c.id)}
                  disabled={c._count.products > 0 || deleteMutation.isPending}
                  className="h-8 w-8 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="dark:bg-slate-800 bg-white rounded-2xl border dark:border-slate-700 border-slate-200 p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold dark:text-white text-slate-900">Bæta við flokki</h2>
              <button onClick={() => setShowCreate(false)} className="dark:text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Parket" className="mt-1" /></div>
              <div>
                <Label>Surface Type</Label>
                <Select value={surfaceType} onValueChange={setSurfaceType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="floor">Gólf (Floor)</SelectItem>
                    <SelectItem value="wall">Veggur (Wall)</SelectItem>
                    <SelectItem value="both">Bæði (Both)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createMutation.mutate({ name, surfaceType })}
                disabled={!name || createMutation.isPending}
                className="w-full text-white hover:opacity-90"
                style={{ backgroundColor: brandColor }}
              >
                {createMutation.isPending ? "Bý til..." : "Búa til flokk"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
