# Exporting

EzRen provides a flexible export system that supports multiple formats and output types. The engine always hides the gizmo before capturing, guaranteeing clean output regardless of the current UI state.

---

## `saveImage` — Recommended

The primary export method. It hides the gizmo automatically and renders the full scene (all visible layers).

```typescript
const blob = await engine.saveImage({
  mimeType: "image/png",     // "image/png" | "image/jpeg" | "image/webp"
  returnType: "blob",        // "blob" | "dataURL"
  quality: 0.9,              // 0.0–1.0 (only for lossy formats: jpeg, webp)
  dimensions: {              // Optional: resize the output
    width: 1920,
    height: 1080,
  },
});
```

### Return Types

```typescript
// As Blob (recommended for download or FormData)
const blob = await engine.saveImage({ mimeType: "image/png", returnType: "blob" });
const url = URL.createObjectURL(blob as Blob);
const a = document.createElement("a");
a.href = url;
a.download = "export.png";
a.click();

// As data URL (base64 embedded, useful for previews or <img> src)
const dataUrl = await engine.saveImage({ mimeType: "image/jpeg", returnType: "dataURL", quality: 0.85 });
previewImg.src = dataUrl as string;
```

---

## `exportImage` — Low-Level

Same as `saveImage` but does **not** hide the gizmo. Useful when you manage the gizmo state yourself.

Returns an `ExportResult` object instead of a raw `Blob | string`:

```typescript
const result = await engine.exportImage({ format: "base64" });
// result.data → base64 string
// result.blob → undefined

const result = await engine.exportImage({ format: "blob" });
// result.blob → Blob
// result.data → undefined
```

`ExportResult` type:

```typescript
interface ExportResult {
  format: "base64" | "blob";
  data?: string | null;  // Populated when format === "base64"
  blob?: Blob;           // Populated when format === "blob"
  mimeType: string;
}
```

---

## `exportOverlays` — Text-Only Export

Exports only the **text layers**, with image layers temporarily hidden. Useful for compositing workflows where you render the base image and text overlays separately.

```typescript
const textBlob = await engine.exportOverlays({
  mimeType: "image/png",
  returnType: "blob",
});
```

---

## Format Guide

| Format | `mimeType` | Notes |
|:-------|:-----------|:------|
| PNG | `"image/png"` | Lossless, supports transparency. Best for graphics, annotations. |
| JPEG | `"image/jpeg"` | Lossy, no transparency. Best for photos. Use `quality: 0.85–0.92`. |
| WebP | `"image/webp"` | Lossy or lossless, supports transparency. Best compression ratio. |

---

## Pixel Operations

EzRen also lets you extract raw pixel data directly for custom processing:

```typescript
// Extract a full copy of the selected layer's pixel buffer
const buffer: PixelBuffer = await engine.cloneLayer();
// buffer.data → Uint8Array (RGBA, 4 bytes per pixel)
// buffer.width, buffer.height → in pixels

// Extract as ImageData (handles rotation and flip via off-screen render pass)
const imageData: ImageData | null = await engine.extractLayerImageData();

// Compute a per-channel histogram (256 bins each)
const hist: HistogramData = await engine.getHistogram();
// hist.r  → Uint32Array[256]
// hist.g  → Uint32Array[256]
// hist.b  → Uint32Array[256]
// hist.lum→ Uint32Array[256]  (0.299R + 0.587G + 0.114B)
```

The histogram is useful for building curves, levels, or auto-enhance features on top of EzRen.
