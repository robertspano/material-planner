"use client";

import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, X, Search, Loader2, Upload, ImageIcon, Pencil, Save, Percent, Trash2, Check, FolderPlus } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAdminCompany } from "@/components/admin/admin-company-context";

interface ProductEntry {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  unit: string;
  discountPercent: number | null;
  imageUrl: string;
  swatchUrl: string | null;
  surfaceTypes: string[];
  tileWidth: number | null;
  tileHeight: number | null;
  tileThickness: number | null;
  isActive: boolean;
  categoryId: string;
  category: { id: string; name: string; surfaceType: string };
}

interface CategoryEntry { id: string; name: string; surfaceType: string; }

export default function ProductsPage({ brandColor: brandColorProp }: { brandColor?: string }) {
  const { adminApiUrl, companySlug } = useAdminCompany();
  // Only fetch company branding if not passed as prop (avoids duplicate query)
  const { data: company } = useQuery<{ primaryColor: string }>({
    queryKey: [`/api/planner/company?company=${companySlug}`],
    enabled: !!companySlug && !brandColorProp,
  });
  const brandColor = brandColorProp || company?.primaryColor || "#2e7cff";
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Category creation
  const [showCreateCat, setShowCreateCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [catSurface, setCatSurface] = useState("floor");

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formUnit, setFormUnit] = useState("m2");
  const [formCatId, setFormCatId] = useState("");
  const [formFloor, setFormFloor] = useState(true);
  const [formWall, setFormWall] = useState(false);
  const [formDiscount, setFormDiscount] = useState("");
  const [formSizes, setFormSizes] = useState<{ width: string; height: string; thickness: string }[]>([{ width: "", height: "", thickness: "" }]);
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formSwatch, setFormSwatch] = useState<File | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const swatchInputRef = useRef<HTMLInputElement>(null);

  // Legacy single-size aliases for backwards compat
  const formTileW = formSizes[0]?.width || "";
  const formTileH = formSizes[0]?.height || "";
  const formTileT = formSizes[0]?.thickness || "";

  const productsUrl = adminApiUrl("/api/admin/products");
  const categoriesUrl = adminApiUrl("/api/admin/categories");

  const { data: products = [], isLoading } = useQuery<ProductEntry[]>({ queryKey: [productsUrl] });
  const { data: categories = [] } = useQuery<CategoryEntry[]>({ queryKey: [categoriesUrl] });

  const createCatMutation = useMutation({
    mutationFn: (data: { name: string; surfaceType: string }) => apiRequest("POST", categoriesUrl, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [categoriesUrl] });
      setShowCreateCat(false);
      setCatName("");
      setCatSurface("floor");
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const st: string[] = []; if (formFloor) st.push("floor"); if (formWall) st.push("wall");
      const validSizes = formSizes.filter(s => s.width || s.height);
      const firstSize = validSizes[0] || { width: "", height: "", thickness: "" };

      // Create parent product with first size
      const fd = new FormData();
      fd.append("name", formName);
      fd.append("categoryId", formCatId);
      if (formDesc) fd.append("description", formDesc);
      if (formPrice) fd.append("price", formPrice);
      fd.append("unit", formUnit);
      fd.append("surfaceTypes", JSON.stringify(st));
      if (formDiscount) fd.append("discountPercent", formDiscount);
      if (firstSize.width) fd.append("tileWidth", firstSize.width);
      if (firstSize.height) fd.append("tileHeight", firstSize.height);
      if (firstSize.thickness) fd.append("tileThickness", firstSize.thickness);
      if (firstSize.width && firstSize.height) fd.append("sizeLabel", `${firstSize.width}x${firstSize.height} cm`);
      if (formSwatch) fd.append("swatch", formSwatch);
      if (formImage) fd.append("image", formImage);
      const res = await fetch(productsUrl, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const parent = await res.json();

      // Create variant products for additional sizes
      if (validSizes.length > 1) {
        for (let i = 1; i < validSizes.length; i++) {
          const size = validSizes[i];
          const vfd = new FormData();
          vfd.append("name", formName);
          vfd.append("categoryId", formCatId);
          if (formDesc) vfd.append("description", formDesc);
          if (formPrice) vfd.append("price", formPrice);
          vfd.append("unit", formUnit);
          vfd.append("surfaceTypes", JSON.stringify(st));
          if (formDiscount) vfd.append("discountPercent", formDiscount);
          if (size.width) vfd.append("tileWidth", size.width);
          if (size.height) vfd.append("tileHeight", size.height);
          if (size.thickness) vfd.append("tileThickness", size.thickness);
          if (size.width && size.height) vfd.append("sizeLabel", `${size.width}x${size.height} cm`);
          vfd.append("parentProductId", parent.id);
          if (formSwatch) vfd.append("swatch", formSwatch);
          if (formImage) vfd.append("image", formImage);
          const vRes = await fetch(productsUrl, { method: "POST", body: vfd, credentials: "include" });
          if (!vRes.ok) console.error("Failed to create variant", i);
        }
      }

      return parent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [productsUrl] });
      setShowCreate(false);
      resetForm();
    },
  });

  // Update product (JSON — no image change) — optimistic for instant toggle
  type UpdateVars = { id: string } & Record<string, unknown>;
  const updateMutation = useMutation<ProductEntry, Error, UpdateVars, { previous?: ProductEntry[] }>({
    mutationFn: async ({ id, ...data }) => {
      const res = await fetch(adminApiUrl(`/api/admin/products/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onMutate: async (variables) => {
      const { id, ...data } = variables;
      await queryClient.cancelQueries({ queryKey: [productsUrl] });
      const previous = queryClient.getQueryData<ProductEntry[]>([productsUrl]);
      queryClient.setQueryData<ProductEntry[]>([productsUrl], (old) =>
        old?.map(p => p.id === id ? { ...p, ...data } as ProductEntry : p)
      );
      return { previous };
    },
    onSuccess: (serverProduct, variables) => {
      // Update cache with actual server data — ensures DB values stick
      queryClient.setQueryData<ProductEntry[]>([productsUrl], (old) =>
        old?.map(p => p.id === variables.id ? { ...p, ...serverProduct } : p)
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData([productsUrl], context.previous);
    },
  });

  // Update product (FormData — with image)
  const updateWithImageMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: FormData }) => {
      const res = await fetch(adminApiUrl(`/api/admin/products/${id}`), {
        method: "PATCH",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [productsUrl] });
      setEditingProduct(null);
    },
  });

  // Delete product
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(adminApiUrl(`/api/admin/products/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [productsUrl] });
      setDeletingId(null);
    },
  });

  const resetForm = () => {
    setFormName(""); setFormDesc(""); setFormPrice(""); setFormUnit("m2");
    setFormCatId(""); setFormFloor(true); setFormWall(false); setFormDiscount("");
    setFormSizes([{ width: "", height: "", thickness: "" }]);
    setFormImage(null); setFormSwatch(null);
  };

  const startEdit = (p: ProductEntry) => {
    setEditingProduct(p);
    setFormName(p.name);
    setFormDesc(p.description || "");
    setFormPrice(p.price?.toString() || "");
    setFormUnit(p.unit);
    setFormCatId(p.categoryId);
    setFormFloor(p.surfaceTypes.includes("floor"));
    setFormWall(p.surfaceTypes.includes("wall"));
    setFormDiscount(p.discountPercent?.toString() || "");
    setFormSizes([{
      width: p.tileWidth?.toString() || "",
      height: p.tileHeight?.toString() || "",
      thickness: p.tileThickness?.toString() || "",
    }]);
    setFormImage(null);
    setFormSwatch(null);
  };

  const handleSaveEdit = () => {
    if (!editingProduct) return;
    const firstSize = formSizes[0] || { width: "", height: "", thickness: "" };
    if (formImage || formSwatch) {
      const fd = new FormData();
      fd.append("name", formName);
      fd.append("categoryId", formCatId);
      fd.append("description", formDesc || "");
      if (formPrice) fd.append("price", formPrice);
      fd.append("unit", formUnit);
      const st: string[] = [];
      if (formFloor) st.push("floor");
      if (formWall) st.push("wall");
      fd.append("surfaceTypes", JSON.stringify(st));
      if (firstSize.width) fd.append("tileWidth", firstSize.width);
      if (firstSize.height) fd.append("tileHeight", firstSize.height);
      if (firstSize.thickness) fd.append("tileThickness", firstSize.thickness);
      fd.append("discountPercent", formDiscount || "");
      if (formImage) fd.append("image", formImage);
      if (formSwatch) fd.append("swatch", formSwatch);
      updateWithImageMutation.mutate({ id: editingProduct.id, formData: fd });
    } else {
      const st: string[] = [];
      if (formFloor) st.push("floor");
      if (formWall) st.push("wall");
      updateMutation.mutate({
        id: editingProduct.id,
        name: formName,
        description: formDesc || null,
        price: formPrice ? parseFloat(formPrice) : null,
        unit: formUnit,
        categoryId: formCatId,
        surfaceTypes: st,
        tileWidth: firstSize.width ? parseFloat(firstSize.width) : null,
        tileHeight: firstSize.height ? parseFloat(firstSize.height) : null,
        tileThickness: firstSize.thickness ? parseFloat(firstSize.thickness) : null,
        discountPercent: formDiscount ? parseFloat(formDiscount) : null,
      });
      setEditingProduct(null);
    }
    resetForm();
  };

  // Quick inline save for price/discount
  const quickSave = useCallback((id: string, field: "price" | "discountPercent", value: string) => {
    const numVal = value ? parseFloat(value) : null;
    updateMutation.mutate({ id, [field]: numVal });
  }, [updateMutation]);

  const filtered = products
    .filter((p) => filterCat === "all" || p.categoryId === filterCat)
    .filter((p) => filterStatus === "all" || (filterStatus === "active" ? p.isActive : !p.isActive))
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Vörur</h2>
        <div className="flex gap-2.5 flex-wrap">
          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Leita..." className="pl-9 h-9 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Allir flokkar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Allir flokkar</SelectItem>
              {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowCreateCat(true)}
            className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: brandColor + "15", color: brandColor }}
          >
            <FolderPlus className="w-4 h-4" /> Nýr flokkur
          </button>
          <button
            onClick={() => { resetForm(); setShowCreate(true); }}
            className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90"
            style={{ backgroundColor: brandColor }}
          >
            <Plus className="w-4 h-4" /> Ný vara
          </button>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1">
        {([
          { value: "all" as const, label: "Allt" },
          { value: "active" as const, label: "Virkt" },
          { value: "inactive" as const, label: "Óvirkt" },
        ]).map((f) => {
          const count = f.value === "all"
            ? products.filter((p) => (filterCat === "all" || p.categoryId === filterCat) && p.name.toLowerCase().includes(search.toLowerCase())).length
            : products.filter((p) => (filterCat === "all" || p.categoryId === filterCat) && p.name.toLowerCase().includes(search.toLowerCase()) && (f.value === "active" ? p.isActive : !p.isActive)).length;
          return (
            <button
              key={f.value}
              onClick={() => setFilterStatus(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterStatus === f.value
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {f.label}
              {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-pulse">
              <div className="aspect-square bg-slate-100" />
              <div className="p-2.5 space-y-2">
                <div className="h-4 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
                <div className="h-3 bg-slate-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="">Engar vörur fundust</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              brandColor={brandColor}
              onEdit={() => startEdit(p)}
              onDelete={() => setDeletingId(p.id)}
              onToggleActive={(v) => updateMutation.mutate({ id: p.id, isActive: v })}
              onQuickSave={quickSave}
            />
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setDeletingId(null)}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Eyða vöru?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {products.find(p => p.id === deletingId)?.name}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-5">
              Þetta eyðir vörunni varanlega. Ekki er hægt að afturkalla þetta.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1 h-9" onClick={() => setDeletingId(null)}>
                Hætta við
              </Button>
              <Button
                className="flex-1 h-9 bg-red-600 hover:bg-red-700 text-white"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingId)}
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Eyða"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Product Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Ný vara</h2>
              <button onClick={() => setShowCreate(false)} className=""><X className="w-5 h-5" /></button>
            </div>
            <ProductForm
              categories={categories}
              brandColor={brandColor}
              formName={formName} setFormName={setFormName}
              formDesc={formDesc} setFormDesc={setFormDesc}
              formPrice={formPrice} setFormPrice={setFormPrice}
              formUnit={formUnit} setFormUnit={setFormUnit}
              formCatId={formCatId} setFormCatId={setFormCatId}
              formFloor={formFloor} setFormFloor={setFormFloor}
              formWall={formWall} setFormWall={setFormWall}
              formDiscount={formDiscount} setFormDiscount={setFormDiscount}
              formSizes={formSizes} setFormSizes={setFormSizes}
              formImage={formImage} setFormImage={setFormImage}
              formSwatch={formSwatch} setFormSwatch={setFormSwatch}
              imageInputRef={imageInputRef}
              swatchInputRef={swatchInputRef}
            />
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formName || !formCatId || createMutation.isPending}
              className="w-full mt-4 text-white hover:opacity-90"
              style={{ backgroundColor: brandColor }}
            >
              {createMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Bý til...</> : "Búa til vöru"}
            </Button>
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => { setEditingProduct(null); resetForm(); }}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Breyta vöru</h2>
              <button onClick={() => { setEditingProduct(null); resetForm(); }} className=""><X className="w-5 h-5" /></button>
            </div>
            {/* Current image preview */}
            {editingProduct.imageUrl && editingProduct.imageUrl !== "" && editingProduct.imageUrl !== "/placeholder-product.jpg" && (
              <div className="mb-4 rounded-lg overflow-hidden">
                <img src={editingProduct.imageUrl} alt={editingProduct.name} className="w-full h-40 object-cover" />
              </div>
            )}
            <ProductForm
              categories={categories}
              brandColor={brandColor}
              formName={formName} setFormName={setFormName}
              formDesc={formDesc} setFormDesc={setFormDesc}
              formPrice={formPrice} setFormPrice={setFormPrice}
              formUnit={formUnit} setFormUnit={setFormUnit}
              formCatId={formCatId} setFormCatId={setFormCatId}
              formFloor={formFloor} setFormFloor={setFormFloor}
              formWall={formWall} setFormWall={setFormWall}
              formDiscount={formDiscount} setFormDiscount={setFormDiscount}
              formSizes={formSizes} setFormSizes={setFormSizes}
              formImage={formImage} setFormImage={setFormImage}
              formSwatch={formSwatch} setFormSwatch={setFormSwatch}
              imageInputRef={imageInputRef}
              swatchInputRef={swatchInputRef}
            />
            <Button
              onClick={handleSaveEdit}
              disabled={!formName || !formCatId || updateWithImageMutation.isPending || updateMutation.isPending}
              className="w-full mt-4 text-white hover:opacity-90"
              style={{ backgroundColor: brandColor }}
            >
              {(updateWithImageMutation.isPending || updateMutation.isPending) ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Vista...</>
              ) : (
                <><Save className="w-4 h-4 mr-1.5" /> Vista breytingar</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Create Category Modal */}
      {showCreateCat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateCat(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-sm w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-slate-900">Nýr flokkur</h2>
              <button onClick={() => setShowCreateCat(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Nafn flokks</Label>
                <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="t.d. Parket, Flísar..." className="mt-1" />
              </div>
              <div>
                <Label className="text-xs">Yfirborðstegund</Label>
                <Select value={catSurface} onValueChange={setCatSurface}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="floor">Gólf</SelectItem>
                    <SelectItem value="wall">Veggur</SelectItem>
                    <SelectItem value="both">Bæði</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => createCatMutation.mutate({ name: catName, surfaceType: catSurface })}
                disabled={!catName || createCatMutation.isPending}
                className="w-full text-white hover:opacity-90"
                style={{ backgroundColor: brandColor }}
              >
                {createCatMutation.isPending ? "Bý til..." : "Búa til flokk"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Product Card with inline quick-edit ── */
function ProductCard({
  product: p,
  brandColor,
  onEdit,
  onDelete,
  onToggleActive,
  onQuickSave,
}: {
  product: ProductEntry;
  brandColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (v: boolean) => void;
  onQuickSave: (id: string, field: "price" | "discountPercent", value: string) => void;
}) {
  const [editingField, setEditingField] = useState<"price" | "discount" | null>(null);
  const [tempValue, setTempValue] = useState("");

  const startInlineEdit = (field: "price" | "discount", e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingField(field);
    if (field === "price") {
      setTempValue(p.price?.toString() || "");
    } else {
      setTempValue(p.discountPercent?.toString() || "");
    }
  };

  const saveInlineEdit = () => {
    if (!editingField) return;
    if (editingField === "price") {
      onQuickSave(p.id, "price", tempValue);
    } else {
      onQuickSave(p.id, "discountPercent", tempValue);
    }
    setEditingField(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveInlineEdit();
    if (e.key === "Escape") setEditingField(null);
  };

  return (
    <div className={`bg-white rounded-xl border border-slate-200 overflow-hidden transition-all hover:shadow-lg group ${!p.isActive ? "opacity-50" : ""}`}>
      <div className="aspect-square bg-slate-100 relative overflow-hidden">
        {(p.swatchUrl || p.imageUrl) && p.imageUrl !== "/placeholder-product.jpg" && p.imageUrl !== "" ? (
          <>
            {/* Default: swatch/material image */}
            <img
              src={p.swatchUrl || p.imageUrl}
              alt={p.name}
              className="w-full h-full object-cover absolute inset-0 transition-opacity duration-300 group-hover:opacity-0"
              loading="lazy"
            />
            {/* Hover: room/installation image */}
            {p.swatchUrl && p.imageUrl && p.imageUrl !== "/placeholder-product.jpg" && (
              <img
                src={p.imageUrl}
                alt={`${p.name} - uppsetning`}
                className="w-full h-full object-cover absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                loading="lazy"
              />
            )}
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-10 h-10 text-slate-300" /></div>
        )}
        {/* Surface type badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          {p.surfaceTypes.map((st) => (
            <Badge key={st} variant="secondary" className="text-[10px] capitalize">{st === "floor" ? "Gólf" : "Veggur"}</Badge>
          ))}
        </div>
        {/* Discount badge */}
        {p.discountPercent ? (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-500 text-white text-[10px] font-bold">
              <Percent className="w-2.5 h-2.5" /> -{p.discountPercent}%
            </span>
          </div>
        ) : null}
        {/* Hover action buttons */}
        <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            className="w-7 h-7 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="w-7 h-7 rounded-lg bg-red-600/80 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="p-2.5">
        <h3 className="font-semibold text-slate-900 text-sm truncate">{p.name}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{p.category.name}</p>
        {(p.tileWidth && p.tileHeight) ? (
          <p className="text-[10px] text-slate-400 mt-0.5">{p.tileWidth}×{p.tileHeight} cm</p>
        ) : null}

        {/* Quick-edit price & discount row */}
        <div className="mt-2 space-y-1.5">
          {/* Price */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 w-8 flex-shrink-0">Verð</span>
            {editingField === "price" ? (
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="number"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="w-full h-6 px-1.5 text-xs rounded border border-slate-300 bg-white text-slate-900 outline-none"
                  placeholder="0"
                />
                <span className="text-[10px] text-slate-400">kr</span>
                <button onClick={saveInlineEdit} className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors text-white" style={{ backgroundColor: brandColor }}>
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => startInlineEdit("price", e)}
                className="flex-1 text-left text-xs font-semibold text-slate-900 transition-colors cursor-text rounded px-1 -mx-1 hover:bg-slate-100"
              >
                {p.price ? `${p.price.toLocaleString()} kr` : "—"}
              </button>
            )}
          </div>

          {/* Discount */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 w-8 flex-shrink-0">Afsl.</span>
            {editingField === "discount" ? (
              <div className="flex items-center gap-1 flex-1">
                <input
                  type="number"
                  value={tempValue}
                  onChange={(e) => setTempValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  min="0"
                  max="100"
                  className="w-full h-6 px-1.5 text-xs rounded border border-slate-300 bg-white text-slate-900 outline-none"
                  placeholder="0"
                />
                <span className="text-[10px] text-slate-400">%</span>
                <button onClick={saveInlineEdit} className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors text-white" style={{ backgroundColor: brandColor }}>
                  <Check className="w-3 h-3 text-white" />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => startInlineEdit("discount", e)}
                className="flex-1 text-left text-xs transition-colors cursor-text rounded px-1 -mx-1 hover:bg-slate-100"
              >
                {p.discountPercent ? (
                  <span className="font-semibold text-emerald-400">-{p.discountPercent}%{p.price ? <span className="text-slate-500 font-normal ml-1">{Math.round(p.price * (1 - p.discountPercent / 100)).toLocaleString()} kr</span> : null}</span>
                ) : (
                  <span className="text-slate-300">Enginn</span>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-end mt-2 pt-1.5 border-t border-slate-100">
          <Switch
            checked={p.isActive}
            onCheckedChange={onToggleActive}
            className="scale-75"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Reusable product form fields ── */
function ProductForm({
  categories, brandColor,
  formName, setFormName, formDesc, setFormDesc,
  formPrice, setFormPrice, formUnit, setFormUnit,
  formCatId, setFormCatId,
  formFloor, setFormFloor, formWall, setFormWall,
  formDiscount, setFormDiscount,
  formSizes, setFormSizes,
  formImage, setFormImage,
  formSwatch, setFormSwatch,
  imageInputRef, swatchInputRef,
}: {
  categories: CategoryEntry[];
  brandColor: string;
  formName: string; setFormName: (v: string) => void;
  formDesc: string; setFormDesc: (v: string) => void;
  formPrice: string; setFormPrice: (v: string) => void;
  formUnit: string; setFormUnit: (v: string) => void;
  formCatId: string; setFormCatId: (v: string) => void;
  formFloor: boolean; setFormFloor: (v: boolean) => void;
  formWall: boolean; setFormWall: (v: boolean) => void;
  formDiscount: string; setFormDiscount: (v: string) => void;
  formSizes: { width: string; height: string; thickness: string }[];
  setFormSizes: (v: { width: string; height: string; thickness: string }[]) => void;
  formImage: File | null; setFormImage: (v: File | null) => void;
  formSwatch: File | null; setFormSwatch: (v: File | null) => void;
  imageInputRef: React.RefObject<HTMLInputElement | null>;
  swatchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const discountedPrice = formPrice && formDiscount
    ? Math.round(parseFloat(formPrice) * (1 - parseFloat(formDiscount) / 100))
    : null;

  const updateSize = (index: number, field: "width" | "height" | "thickness", value: string) => {
    const updated = [...formSizes];
    updated[index] = { ...updated[index], [field]: value };
    setFormSizes(updated);
  };

  const addSize = () => {
    setFormSizes([...formSizes, { width: "", height: "", thickness: "" }]);
  };

  const removeSize = (index: number) => {
    if (formSizes.length <= 1) return;
    setFormSizes(formSizes.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Nafn</Label>
        <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Eik Natural 3-strip" className="mt-1 h-9 text-sm" />
      </div>
      <div>
        <Label className="text-xs">Lýsing</Label>
        <Input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Valfrjáls lýsing" className="mt-1 h-9 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Verð</Label>
          <Input type="number" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} placeholder="4500" className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Eining</Label>
          <Select value={formUnit} onValueChange={setFormUnit}>
            <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="m2">m²</SelectItem>
              <SelectItem value="piece">stk</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Discount — highlighted section */}
      <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
        <Label className="text-xs font-semibold flex items-center gap-1.5 text-red-600">
          <Percent className="w-3 h-3" /> Afsláttur
        </Label>
        <div className="flex items-center gap-3 mt-1.5">
          <div className="relative flex-1">
            <Input
              type="number"
              value={formDiscount}
              onChange={(e) => setFormDiscount(e.target.value)}
              placeholder="0"
              min="0"
              max="100"
              className="h-9 text-sm pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
          </div>
          {discountedPrice !== null && discountedPrice > 0 && (
            <div className="flex-shrink-0 text-right">
              <p className="text-xs font-bold text-slate-900">{discountedPrice.toLocaleString()} kr</p>
              <p className="text-[10px] line-through text-slate-400">{parseFloat(formPrice).toLocaleString()} kr</p>
            </div>
          )}
        </div>
        {!formDiscount && (
          <div className="flex gap-1.5 mt-2">
            {[10, 15, 20, 25, 30, 50].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setFormDiscount(pct.toString())}
                className="text-[10px] px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-600 hover:opacity-80 transition-opacity"
              >
                {pct}%
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label className="text-xs">Flokkur</Label>
        <Select value={formCatId} onValueChange={setFormCatId}>
          <SelectTrigger className="mt-1 h-9 text-sm"><SelectValue placeholder="Veldu flokk" /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} ({c.surfaceType === "floor" ? "Gólf" : c.surfaceType === "wall" ? "Veggur" : "Bæði"})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="text-xs">Yfirborð</Label>
        <div className="flex gap-4 mt-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={formFloor} onCheckedChange={(v) => setFormFloor(!!v)} />
            <span className="text-sm text-slate-900">Gólf</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={formWall} onCheckedChange={(v) => setFormWall(!!v)} />
            <span className="text-sm text-slate-900">Veggur</span>
          </label>
        </div>
      </div>

      {/* Multi-size tile dimensions */}
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Stærðir (cm / mm)</Label>
          <button
            type="button"
            onClick={addSize}
            className="text-[10px] px-2 py-0.5 rounded-md font-medium transition-colors hover:opacity-80"
            style={{ backgroundColor: brandColor + "15", color: brandColor }}
          >
            + Bæta við stærð
          </button>
        </div>
        <div className="space-y-2 mt-1.5">
          {formSizes.map((size, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className="flex-1 grid grid-cols-3 gap-1.5">
                <Input
                  type="number"
                  value={size.width}
                  onChange={(e) => updateSize(i, "width", e.target.value)}
                  placeholder="Breidd"
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  value={size.height}
                  onChange={(e) => updateSize(i, "height", e.target.value)}
                  placeholder="Hæð"
                  className="h-8 text-xs"
                />
                <Input
                  type="number"
                  value={size.thickness}
                  onChange={(e) => updateSize(i, "thickness", e.target.value)}
                  placeholder="Þykkt"
                  className="h-8 text-xs"
                />
              </div>
              {formSizes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSize(i)}
                  className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {formSizes.length === 1 && (
            <div className="grid grid-cols-3 gap-1.5">
              <span className="text-[10px] text-slate-400">Breidd cm</span>
              <span className="text-[10px] text-slate-400">Hæð cm</span>
              <span className="text-[10px] text-slate-400">Þykkt mm</span>
            </div>
          )}
          {formSizes.length > 1 && (
            <p className="text-[10px] text-slate-400">
              {formSizes.filter(s => s.width || s.height).length} stærðir — fyrsta stærð er aðalvara, aðrar verða stærðar-variant
            </p>
          )}
        </div>
      </div>

      {/* Swatch / material image upload */}
      <div>
        <Label className="text-xs">Vörumynd (efni / litur)</Label>
        <div
          className="mt-1 flex items-center justify-center w-full h-20 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
          onClick={() => swatchInputRef.current?.click()}
        >
          {formSwatch ? (
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-slate-500" />
              <span className="text-sm text-slate-700 truncate max-w-[200px]">{formSwatch.name}</span>
              <button onClick={(e) => { e.stopPropagation(); setFormSwatch(null); }} className="text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="text-center">
              <Upload className="w-5 h-5 mx-auto text-slate-400" />
              <span className="text-xs text-slate-400">Mynd af efninu / litnum</span>
            </div>
          )}
          <input ref={swatchInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => setFormSwatch(e.target.files?.[0] || null)} />
        </div>
      </div>

      {/* Room / hover image upload */}
      <div>
        <Label className="text-xs">Hover mynd (herbergi / uppsetning)</Label>
        <div
          className="mt-1 flex items-center justify-center w-full h-20 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors"
          onClick={() => imageInputRef.current?.click()}
        >
          {formImage ? (
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-slate-500" />
              <span className="text-sm text-slate-700 truncate max-w-[200px]">{formImage.name}</span>
              <button onClick={(e) => { e.stopPropagation(); setFormImage(null); }} className="text-red-400 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <div className="text-center">
              <Upload className="w-5 h-5 mx-auto text-slate-400" />
              <span className="text-xs text-slate-400">Mynd af efni í herbergi (valfrjáls)</span>
            </div>
          )}
          <input ref={imageInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => setFormImage(e.target.files?.[0] || null)} />
        </div>
      </div>
    </div>
  );
}
