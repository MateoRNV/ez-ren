# Presets

EzRen comes with a built-in preset system for common destructive filters and crop aspect ratios. You can also register your own custom presets and retrieve the full list at runtime.

---

## Filter Presets

Filter presets are **destructive CPU operations** — they permanently modify the layer's pixel buffer and record an undo command automatically.

### Built-in Filters

```typescript
await engine.presets.applyFilter("grayscale");
await engine.presets.applyFilter("sepia");
await engine.presets.applyFilter("invert");
await engine.presets.applyFilter("threshold");
await engine.presets.applyFilter("solarize");
```

### Built-in Filter Algorithms

| Filter | Algorithm |
|:-------|:----------|
| `grayscale` | `luma = 0.299R + 0.587G + 0.114B` (ITU-R BT.601) |
| `sepia` | W3C standard matrix: `R' = 0.393R + 0.769G + 0.189B`, etc. |
| `invert` | `channel = 255 - channel` |
| `threshold` | `luma > 128 ? 255 : 0` (binary black & white) |
| `solarize` | `channel > 128 ? 255 - channel : channel` |

All built-in filters mutate the `PixelBuffer` **in place** (zero-copy pattern) and return the same object.

### Registering a Custom Filter Preset

```typescript
engine.presets.registerFilter("vintage", (buffer) => {
  const { data } = buffer;
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, data[i] * 1.1 + 20);   // boost red
    data[i + 2] = Math.max(0,   data[i + 2] * 0.85);   // reduce blue
  }
  return buffer;
});

await engine.presets.applyFilter("vintage");
```

Your function receives a `PixelBuffer`:

```typescript
interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray; // Raw RGBA bytes (4 bytes per pixel)
  width: number;
  height: number;
}
```

### Listing Available Filter Presets

```typescript
engine.presets.listFilters();
// → ["grayscale", "sepia", "invert", "threshold", "solarize", "vintage"]
```

---

## Crop Presets

Crop presets are **destructive operations** that crop the selected image layer to a specific aspect ratio, centered on the original image. They record an undo command automatically.

### Built-in Crop Presets

```typescript
await engine.presets.applyCrop("square");     // 1:1  — centered
await engine.presets.applyCrop("landscape");  // 16:9 — centered
await engine.presets.applyCrop("portrait");   // 9:16 — centered
await engine.presets.applyCrop("story");      // 9:16 — alias for portrait
```

### Built-in Crop Algorithms

| Preset | Ratio | Strategy |
|:-------|:------|:---------|
| `square` | 1:1 | Uses the shorter side, centered |
| `landscape` | 16:9 | Fits within the image bounds, centered |
| `portrait` | 9:16 | Fits within the image bounds, centered |
| `story` | 9:16 | Alias for `portrait` |

### Manual Crop

If you need precise control over the crop rectangle:

```typescript
await engine.applyCrop({ x: 100, y: 50, width: 800, height: 600 });
```

Coordinates are in **texture space** (pixels of the original image), not canvas space.
Use `engine.canvasToImage()` or `engine.getTextureRect()` to convert if needed.

### Registering a Custom Crop Preset

A crop preset is a function that receives the image's `width` and `height` and returns a `Rect`:

```typescript
engine.presets.registerCrop("banner", (width, height) => {
  const targetRatio = 3 / 1; // 3:1 banner
  const cropW = width;
  const cropH = Math.round(width / targetRatio);
  return {
    x: 0,
    y: Math.round((height - cropH) / 2), // vertically centered
    width: cropW,
    height: cropH,
  };
});

await engine.presets.applyCrop("banner");
```

### Listing Available Crop Presets

```typescript
engine.presets.listCrops();
// → ["square", "landscape", "portrait", "story", "banner"]
```

---

## Resize

Resize is not part of the presets API but functions similarly — it is a destructive operation that uses high-quality browser 2D canvas downscaling and records an undo command:

```typescript
await engine.resize(1920, 1080); // Target width × height in pixels
```

#### Common size presets pattern:

```typescript
const sizes = [
  { label: "Full HD",   w: 1920, h: 1080 },
  { label: "HD",        w: 1280, h: 720  },
  { label: "Square 800", w: 800,  h: 800  },
  { label: "Square 500", w: 500,  h: 500  },
];

for (const size of sizes) {
  btn.addEventListener("click", () => engine.resize(size.w, size.h));
}
```
