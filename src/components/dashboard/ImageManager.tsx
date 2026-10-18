"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Mirrors MAX_IMAGES / MAX_UPLOAD_BYTES in src/lib/product-images.ts. */
const MAX_IMAGES = 24;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Larger photos are shrunk in the browser first so they fit the upload limit. */
const SHRINK_ABOVE_BYTES = 3.5 * 1024 * 1024;
const SHRINK_TO_LONG_SIDE = 2400;

type Props = {
  externalId: string;
  title: string;
  onClose: () => void;
  /** Called after the image list changes on the server (save, upload or reset). */
  onChanged: () => void;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** Phone photos can be 10 MB+; re-encode them as a smaller JPEG before upload. */
async function shrinkIfLarge(file: File): Promise<Blob> {
  if (file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_TO_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

function move<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function ArrowIcon({ direction, className }: { direction: "left" | "right"; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className} aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Edit a product's listing images: drag (or use the arrows) to reorder — the
 * first image is the eBay main photo — remove photos, upload your own, and
 * save. Changes apply to this seller's future listings only.
 */
export function ImageManager({ externalId, title, onClose, onChanged }: Props) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [images, setImages] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState<null | "saving" | "uploading" | "resetting">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const dirty = images.join("\n") !== saved.join("\n");

  const fetchImages = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch(`/api/products/images?externalId=${encodeURIComponent(externalId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setLoad({ status: "error", message: body?.error ?? `Couldn't load the images (HTTP ${res.status}).` });
        return;
      }
      setImages(body.images);
      setSaved(body.images);
      setCustom(Boolean(body.custom));
      setLoad({ status: "ready" });
    } catch {
      setLoad({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }, [externalId]);

  useEffect(() => {
    void fetchImages();
  }, [fetchImages]);

  useEffect(() => {
    dialogRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  async function save() {
    setBusy("saving");
    setMessage(null);
    try {
      const res = await fetch("/api/products/images", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId, images }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setMessage({ tone: "error", text: body?.error ?? `Couldn't save (HTTP ${res.status}).` });
      } else {
        setSaved(body.images);
        setImages(body.images);
        setCustom(true);
        setMessage({ tone: "ok", text: "Saved. Your next listing of this product uses these images in this order." });
        onChanged();
      }
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach AutoPilot. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (images.length >= MAX_IMAGES) {
      setMessage({ tone: "error", text: `eBay allows ${MAX_IMAGES} images. Remove one before uploading.` });
      return;
    }
    if (!file.type.startsWith("image/")) {
      setMessage({ tone: "error", text: "Choose an image file (JPG, PNG, WebP or GIF)." });
      return;
    }
    setBusy("uploading");
    setMessage(null);
    try {
      const blob = await shrinkIfLarge(file);
      if (blob.size > MAX_UPLOAD_BYTES) {
        setMessage({ tone: "error", text: "That image is over 4 MB. Choose a smaller one." });
        return;
      }
      const form = new FormData();
      form.set("externalId", externalId);
      form.set("file", blob, file.name || "upload.jpg");
      const res = await fetch("/api/products/images/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setMessage({ tone: "error", text: body?.error ?? `Upload failed (HTTP ${res.status}).` });
        return;
      }
      // The server saved [upload, ...saved list]; keep any unsaved reordering here.
      setSaved(body.images);
      setImages((prev) => [body.url, ...prev.filter((url) => url !== body.url)]);
      setCustom(true);
      setMessage({ tone: "ok", text: `Uploaded (${body.width}×${body.height}) and set as the main image.` });
      onChanged();
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach AutoPilot. Try again." });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function reset() {
    if (!window.confirm("Go back to the supplier's images? Your order and removed photos are discarded (uploads are kept on file).")) return;
    setBusy("resetting");
    setMessage(null);
    try {
      const res = await fetch(`/api/products/images?externalId=${encodeURIComponent(externalId)}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setMessage({ tone: "error", text: body?.error ?? `Couldn't reset (HTTP ${res.status}).` });
      } else {
        setImages(body.images);
        setSaved(body.images);
        setCustom(false);
        setMessage({ tone: "ok", text: "Back to the supplier's images." });
        onChanged();
      }
    } catch {
      setMessage({ tone: "error", text: "Couldn't reach AutoPilot. Try again." });
    } finally {
      setBusy(null);
    }
  }

  function onDrop(index: number) {
    if (dragFrom !== null && dragFrom !== index) setImages((prev) => move(prev, dragFrom, index));
    setDragFrom(null);
    setDragOver(null);
  }

  const working = busy !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-manager-title"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-navy-950 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="image-manager-title" className="text-lg font-semibold leading-snug text-white">
              Edit images
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-400" title={title}>
              {title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-white/15 p-1.5 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {load.status === "loading" ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" aria-busy="true" aria-label="Loading images">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="aspect-square animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>
          ) : load.status === "error" ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {load.message}{" "}
              <button type="button" onClick={() => void fetchImages()} className="font-semibold underline">
                Try again
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-400">
                Drag to reorder (or use the arrows). The first image is the main photo on eBay. {images.length}/{MAX_IMAGES}{" "}
                images{custom ? " · your custom set" : " · supplier images"}.
              </p>
              {images.length ? (
                <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {images.map((url, index) => (
                    <li
                      key={url}
                      draggable={!working}
                      onDragStart={(event) => {
                        setDragFrom(index);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragOver !== index) setDragOver(index);
                      }}
                      onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
                      onDrop={(event) => {
                        event.preventDefault();
                        onDrop(index);
                      }}
                      onDragEnd={() => {
                        setDragFrom(null);
                        setDragOver(null);
                      }}
                      className={`group relative aspect-square cursor-grab overflow-hidden rounded-lg border bg-white/5 active:cursor-grabbing ${
                        dragOver === index && dragFrom !== index
                          ? "border-brand-400 ring-2 ring-brand-400/60"
                          : index === 0
                            ? "border-lime-brand/60"
                            : "border-white/10"
                      } ${dragFrom === index ? "opacity-40" : ""}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Image ${index + 1}`} draggable={false} className="h-full w-full object-cover" />
                      {index === 0 ? (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-lime-brand px-2 py-0.5 text-[10px] font-bold text-navy-950">
                          Main
                        </span>
                      ) : (
                        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {index + 1}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                        disabled={working || images.length <= 1}
                        aria-label={`Remove image ${index + 1}`}
                        title={images.length <= 1 ? "A listing needs at least one image" : "Remove"}
                        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500 disabled:opacity-40"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true">
                          <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                        </svg>
                      </button>
                      <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
                        <button
                          type="button"
                          onClick={() => setImages((prev) => move(prev, index, index - 1))}
                          disabled={working || index === 0}
                          aria-label={`Move image ${index + 1} earlier`}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-brand-500 disabled:invisible"
                        >
                          <ArrowIcon direction="left" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setImages((prev) => move(prev, index, index + 1))}
                          disabled={working || index === images.length - 1}
                          aria-label={`Move image ${index + 1} later`}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-brand-500 disabled:invisible"
                        >
                          <ArrowIcon direction="right" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-400">
                  This product has no images yet. Upload one to list it on eBay.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 px-5 py-4">
          {message ? (
            <p role="status" className={`text-xs ${message.tone === "ok" ? "text-lime-brand" : "text-red-300"}`}>
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              aria-label="Upload custom image"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={working || load.status !== "ready" || images.length >= MAX_IMAGES}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/5 disabled:opacity-50"
            >
              {busy === "uploading" ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-4 w-4" aria-hidden="true">
                  <path d="M12 16V4M7 9l5-5 5 5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {busy === "uploading" ? "Uploading…" : "Upload custom image"}
            </button>
            {custom ? (
              <button
                type="button"
                onClick={() => void reset()}
                disabled={working}
                className="rounded-full px-3 py-2 text-xs font-medium text-slate-400 hover:text-white disabled:opacity-50"
              >
                {busy === "resetting" ? "Resetting…" : "Use supplier images"}
              </button>
            ) : null}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
              >
                {dirty ? "Cancel" : "Close"}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={working || !dirty || !images.length}
                className="rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
              >
                {busy === "saving" ? "Saving…" : "Save order"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
