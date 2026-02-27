"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { Upload, ImageIcon, X, Plus, Loader2, CheckCircle, Camera, SwitchCamera, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RoomEntry {
  imageUrl: string;
  generationId: string;
  /** Local blob URL for instant preview before server image loads */
  localPreviewUrl?: string;
}

interface ImagePreview {
  id: string;
  file: File;
  objectUrl: string;
  status: "uploading" | "done" | "error";
  imageUrl?: string;
  generationId?: string;
  error?: string;
}

interface RoomUploadProps {
  onUploaded: (entries: RoomEntry[]) => void;
  companySlug: string;
}

// ---------- Camera modal component ----------
function CameraCapture({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    // Stop any existing stream
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      setStream(s);
      setError(null);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {
      setError("Ekki tókst að opna myndavél. Athugaðu leyfi.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      // Cleanup on unmount
      setStream(prev => {
        prev?.getTracks().forEach(t => t.stop());
        return null;
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flipCamera = () => {
    const next = facingMode === "environment" ? "user" : "environment";
    setFacingMode(next);
    startCamera(next);
  };

  const takePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
      setPhotoCount(prev => prev + 1);
    }, "image/jpeg", 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 bg-black/80 z-10">
        <button onClick={onClose} className="text-white p-2">
          <X className="w-6 h-6" />
        </button>
        {photoCount > 0 && (
          <span className="text-white/80 text-sm font-medium">
            {photoCount} {photoCount === 1 ? "mynd tekin" : "myndir teknar"}
          </span>
        )}
        <button onClick={flipCamera} className="text-white p-2">
          <SwitchCamera className="w-6 h-6" />
        </button>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
            <XCircle className="w-12 h-12 text-red-400" />
            <p className="text-white text-center">{error}</p>
            <Button onClick={() => startCamera(facingMode)} variant="outline" className="text-white border-white/30">
              Reyna aftur
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-6 p-6 pb-8 bg-black/80">
        {photoCount > 0 && (
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-full bg-white text-black font-semibold text-sm"
          >
            Búinn ({photoCount})
          </button>
        )}
        <button
          onClick={takePhoto}
          disabled={!!error}
          className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 active:bg-white/60 transition-colors disabled:opacity-30 flex items-center justify-center"
        >
          <div className="w-12 h-12 rounded-full bg-white" />
        </button>
        {photoCount === 0 && <div className="w-[76px]" />}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

// ---------- Image compression ----------
function compressImage(file: File, maxDimension = 2048, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    // If already small enough, skip compression
    if (file.size <= 4 * 1024 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // Scale down if needed
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file); // Compression didn't help, use original
            return;
          }
          const compressed = new File([blob], file.name, { type: "image/jpeg" });
          resolve(compressed);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // On error, just use original
    };
    img.src = url;
  });
}

// ---------- Main upload component ----------
export function RoomUpload({ onUploaded, companySlug }: RoomUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [previews, setPreviews] = useState<ImagePreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File, id: string) => {
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch(`/api/planner/upload?company=${companySlug}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      setPreviews(prev => prev.map(p =>
        p.id === id
          ? { ...p, status: "done" as const, imageUrl: data.imageUrl || data.roomImageUrl, generationId: data.id }
          : p
      ));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setPreviews(prev => prev.map(p =>
        p.id === id ? { ...p, status: "error" as const, error: message } : p
      ));
    }
  }, [companySlug]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const validFiles: { file: File; preview: ImagePreview }[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setError("Aðeins myndir eru leyfðar");
        continue;
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview: ImagePreview = {
        id,
        file,
        objectUrl: URL.createObjectURL(file),
        status: "uploading",
      };
      validFiles.push({ file, preview });
    }

    if (validFiles.length === 0) return;

    setPreviews(prev => [...prev, ...validFiles.map(v => v.preview)]);

    // Compress large images then upload all in parallel
    await Promise.all(validFiles.map(async ({ file, preview }) => {
      const compressed = await compressImage(file);
      return uploadFile(compressed, preview.id);
    }));
  }, [uploadFile]);

  const handleCameraCapture = useCallback((file: File) => {
    handleFiles([file]);
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const removePreview = (id: string) => {
    setPreviews(prev => {
      const item = prev.find(p => p.id === id);
      if (item) URL.revokeObjectURL(item.objectUrl);
      return prev.filter(p => p.id !== id);
    });
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const doneEntries = previews
    .filter(p => p.status === "done" && p.imageUrl && p.generationId)
    .map(p => ({ imageUrl: p.imageUrl!, generationId: p.generationId!, localPreviewUrl: p.objectUrl }));

  const hasUploading = previews.some(p => p.status === "uploading");

  const handleContinue = () => {
    if (doneEntries.length > 0) {
      onUploaded(doneEntries);
    }
  };

  // Hidden file input for gallery
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      className="hidden"
      accept="image/*"
      multiple
      onChange={(e) => {
        if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  // Camera modal
  if (showCamera) {
    return (
      <CameraCapture
        onCapture={handleCameraCapture}
        onClose={() => setShowCamera(false)}
      />
    );
  }

  // Empty state — no images yet
  if (previews.length === 0) {
    return (
      <div className="space-y-4">
        {/* Two action cards side by side */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Upload from gallery */}
          <div
            onClick={openFilePicker}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`group relative bg-white rounded-2xl p-6 text-center cursor-pointer transition-all hover:shadow-lg border-2 ${
              dragOver
                ? "border-[var(--brand-primary)] shadow-lg bg-[var(--brand-primary)]/5"
                : "border-transparent hover:border-[var(--brand-primary)]/30"
            } shadow-sm`}
          >
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-transform group-hover:scale-110" style={{ backgroundColor: "var(--brand-primary)" }}>
              <Upload className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Hlaða upp myndum
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Veldu úr galleríi eða dragðu myndir hingað
            </p>
          </div>

          {/* Take photo */}
          <div
            onClick={() => setShowCamera(true)}
            className="group relative bg-white rounded-2xl p-6 text-center cursor-pointer transition-all hover:shadow-lg border-2 border-transparent hover:border-[var(--brand-primary)]/30 shadow-sm"
          >
            <div className="w-14 h-14 rounded-2xl bg-slate-800 mx-auto mb-4 flex items-center justify-center transition-transform group-hover:scale-110">
              <Camera className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Taka mynd
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Opnaðu myndavélina og taktu myndir beint
            </p>
          </div>
        </div>

        {hiddenInput}
        {error && <p className="text-red-400 text-sm text-center mt-2">{error}</p>}
      </div>
    );
  }

  // Has images — show thumbnail grid
  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${dragOver ? "ring-2 ring-[var(--brand-primary)] rounded-2xl p-1" : ""}`}
      >
        {previews.map((p) => (
          <div key={p.id} className="relative aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 group shadow-sm">
            <img src={p.objectUrl} alt="" className="w-full h-full object-cover" />

            {/* Upload status overlay */}
            {p.status === "uploading" && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-white animate-spin" />
              </div>
            )}
            {p.status === "done" && (
              <div className="absolute top-2 left-2">
                <CheckCircle className="w-5 h-5 text-green-400 drop-shadow-lg" />
              </div>
            )}
            {p.status === "error" && (
              <div className="absolute inset-0 bg-red-900/50 flex items-center justify-center p-2">
                <p className="text-white text-xs text-center">{p.error || "Villa"}</p>
              </div>
            )}

            {/* Remove button */}
            <button
              onClick={() => removePreview(p.id)}
              className="absolute top-2 right-2 w-6 h-6 bg-black/60 hover:bg-black/80 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Add more — two buttons stacked */}
        <div className="aspect-[4/3] rounded-xl border-2 border-dashed border-slate-300 bg-white flex flex-col items-center justify-center gap-2.5">
          <button
            onClick={openFilePicker}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-xs font-medium">Úr galleríi</span>
          </button>
          <button
            onClick={() => setShowCamera(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <Camera className="w-4 h-4" />
            <span className="text-xs font-medium">Taka mynd</span>
          </button>
        </div>
      </div>

      {hiddenInput}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Continue button */}
      <Button
        onClick={handleContinue}
        disabled={doneEntries.length === 0 || hasUploading}
        className="w-full py-5 text-white rounded-xl transition-all duration-200 hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md"
        style={{ backgroundColor: "var(--brand-primary)" }}
      >
        {hasUploading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Hleð upp...
          </>
        ) : (
          `Halda áfram${doneEntries.length > 1 ? ` (${doneEntries.length} myndir)` : ""}`
        )}
      </Button>
    </div>
  );
}
