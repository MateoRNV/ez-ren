# Filters

EzRen exposes two complementary filter systems that can be used independently or together. Understanding their differences is key to getting the most out of the engine.

---

## Overview

| | GPU Live Filters | CPU / WASM Filters |
|:--|:--|:--|
| **Performance** | Zero pixel-buffer cost | Full pixel-buffer read/write |
| **Effect on pixels** | Non-destructive | Destructive (modifies texture) |
| **Undo/Redo** | ✅ Supported | ✅ Supported (before/after snapshots) |
| **Real-time** | ✅ Instant | ⚠️ Async (awaitable) |
| **Use for** | Color grading, blur, opacity sliders | Grayscale, sepia, artistic effects |

---

## 1. GPU Live Filters

Live filters are applied as **PixiJS shader programs** directly on the GPU. They do not modify the underlying pixel buffer — they only affect how the layer is rendered. This makes them ideal for real-time adjustments driven by sliders.

### Sugar API (Recommended)

The Sugar API is the simplest and most common way to apply live filters. Each call either creates the filter if it doesn't exist yet, or updates it in place.

```typescript
engine.setBrightness(layerId, 1.2);  // 1.0 = original, 0–2 range
engine.setContrast(layerId, 1.1);    // 0.0 = no contrast
engine.setSaturation(layerId, 0.8);  // 0.0 = grayscale, 1.0 = original
engine.setHue(layerId, 45);          // Degrees, -180 to 180
engine.setBlur(layerId, 5);          // Blur strength, 0 = no blur
engine.setOpacity(layerId, 0.9);     // 0.0 = transparent, 1.0 = opaque
```

### Low-Level Filter API

For more control, the low-level API lets you add, update and remove individual filter effects by ID:

```typescript
// Add a filter and get its effect ID
const fxId = engine.filters.add(layerId, "color", {
  brightness: 1.2,
  contrast: 1.1,
  saturation: 0.8,
  hue: 30,
});

// Update specific params on an existing filter
engine.filters.update(layerId, fxId, { brightness: 1.5 });

// Remove a filter
engine.filters.remove(layerId, fxId);

// Get all active filters on a layer
const active = engine.filters.get(layerId); // → LiveFilterDef[]
```

### Available Live Filter Types

| Type | PixiJS Filter | Key Params |
|:-----|:-------------|:-----------|
| `"color"` | `ColorMatrixFilter` | `brightness`, `contrast`, `saturation`, `hue` |
| `"blur"` | `BlurFilter` | `strength: number` |
| `"noise"` | `NoiseFilter` | `noise: number` |
| `"adjustment"` | `AlphaFilter` | `alpha: number` |

#### How `"color"` Filter Chaining Works

When you set multiple properties on a `"color"` filter (brightness, contrast, saturation, hue), they are chained via `multiply=true` on the PixiJS `ColorMatrixFilter`. This means they accumulate correctly:

```
reset()                   → identity matrix
brightness(b, true)       → identity × brightness
contrast(c, true)         → × contrast
saturate(s, true)         → × saturation
hue(h, true)              → × hue shift
```

---

## 2. CPU / WASM Filters

CPU filters operate on the raw RGBA pixel buffer. They are **destructive** — they permanently modify the layer's texture. However, they are **fully undoable**: EzRen takes a before and after pixel snapshot automatically and records a command to the undo stack.

### Using Built-in Preset Filters

The easiest way to apply destructive filters is through the presets API:

```typescript
await engine.presets.applyFilter("grayscale");
await engine.presets.applyFilter("sepia");
await engine.presets.applyFilter("invert");
await engine.presets.applyFilter("threshold");
await engine.presets.applyFilter("solarize");
```

See [Presets →](./presets.md) for full coverage of the preset system.

### Registering a Custom Pixel Filter

You can register any function that takes and returns a `PixelBuffer`:

```typescript
engine.registerFilter("neon", (buffer) => {
  const { data } = buffer;
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = 255 - data[i];     // invert R
    data[i + 2] = 255 - data[i + 2]; // invert B
    // leave G and A unchanged
  }
  return buffer; // mutate in-place and return
});

// Apply it (GPU → CPU read → filter → GPU upload, records undo command)
await engine.applyWasmFilter("neon");
```

The `PixelBuffer` type is:

```typescript
interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray; // Raw RGBA bytes
  width: number;
  height: number;
}
```

> **Tip:** Mutate `buffer.data` in place and return the same object for maximum performance (zero-copy). EzRen snapshots the data **before** calling your function, so you never risk corrupting the undo history.

### Raw Pixel Sync (Preview Only)

If you want to upload a pixel buffer to the layer **without recording an undo command** (e.g., for a live preview slider), use `syncPixels`:

```typescript
await engine.syncPixels(myBuffer);
// Emits "layer:update" but does NOT push to the undo stack
```

This is useful for hover previews or sliders before committing a destructive change.

---

## Combining Both Systems

GPU and CPU filters can be used simultaneously on the same layer. A common pattern is:

1. Use **GPU live filters** for real-time slider adjustments (brightness, contrast, saturation).
2. Once satisfied, use **CPU destructive filters** to bake specific looks (grayscale, sepia).

```typescript
// Real-time adjustment (non-destructive)
engine.setBrightness(layerId, 1.3);
engine.setContrast(layerId, 1.1);

// Bake an effect when user clicks "Apply"
await engine.presets.applyFilter("sepia"); // destructive, records undo
```
