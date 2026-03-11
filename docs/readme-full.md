# EzRen v3.0 — Complete Technical Reference

EzRen is a framework-agnostic, headless GPU image editing engine built on **PixiJS v8 (WebGL/WebGPU)** and **Photon (WASM/Rust)**. It exposes a clean TypeScript API that abstracts the complexity of canvas setup, shader pipelines, coordinate mapping, and undo/redo management.

---

## Architecture Overview

v3.0 splits the engine into a headless nucleus (`EzRenCore`) and an interaction layer (`EzRenInteraction`). The `EzRen` class acts as a high-level facade that composes both.

```
EzRen (Facade — batteries-included for browsers)
├── EzRenCore (Nucleus — Headless)
│   ├── RenderSystem        — PixiJS Application, canvas, resize, pixel extraction
│   ├── LayerManager        — Scene graph registry + transform sync
│   ├── CommandManager      — Undo/redo stack + history events
│   ├── FilterManager       — GPU live-filter pipeline (non-destructive)
│   ├── PresetManager       — Built-in CPU filters & crop presets
│   └── PluginManager       — Third-party extensions
└── EzRenInteraction (Runtime — Interactive)
    └── TransformerGizmo    — Visual handles & real-time drag/scale/rotate
```

### File Layout

```
src/
  EzRen.ts                          # High-level facade (Batteries included)
  types.ts                          # All exported interfaces & types
  index.ts                          # Package entry point
  core/
    EzRenCore.ts                    # Headless nucleus (Events, Managers, Rendering)
    EventEmitter.ts                 # Lightweight typed event system
    rendering/
      RenderSystem.ts               # PixiJS app + extract + export
    managers/
      LayerManager.ts               # Layer registry + transform sync
      CommandManager.ts             # Undo/redo stack
      FilterManager.ts              # Live GPU filters
      PresetManager.ts              # Built-in filter & crop presets
      PluginManager.ts              # Plugin install/guard
  runtime/
    EzRenInteraction.ts             # Runtime for pointer events & selection
    gizmo/
      TransformerGizmo.ts           # Drag handles (Container)
```

### Usage Modes

| Mode | Import | Use case |
|:-----|:-------|:---------|
| Full interactive | `import { EzRen } from "ez-ren"` | Browser editing with gizmo & pointer events |
| Headless core | `import { EzRenCore } from "ez-ren"` | Server-side processing, batch pipelines |
| Custom runtime | `import { EzRenCore, EzRenInteraction } from "ez-ren"` | Custom interaction layer |

---

## Initialization

```typescript
import { EzRen } from "ez-ren";

const engine = new EzRen({
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
  backgroundColor: 0x1a1a2e,         // optional, default
  resolution: window.devicePixelRatio, // optional, defaults to devicePixelRatio
  antialias: true,                    // optional, default
  maxHistory: 50,                     // optional — undo/redo stack size
});

await engine.init();
```

### Headless Mode

```typescript
import { EzRenCore } from "ez-ren";

const core = new EzRenCore({ canvas, backgroundColor: 0x000000 });
await core.init();

// No gizmo, no pointer events — just the rendering pipeline
const id = await core.addImageLayer("photo.jpg");
await core.applyWasmFilter("grayscale");
const blob = await core.saveImage({ format: "blob" });
```

### Lifecycle

```typescript
await engine.init();    // Initialize PixiJS app + load Photon WASM
engine.destroy();       // Full teardown (layers, filters, history, renderer)
```

---

## Scene Graph

All layers live in a single `sceneContainer` with `sortableChildren = true`. Render order is controlled by `zIndex`:

| Layer type | Default zIndex range |
|:-----------|:---------------------|
| Image      | 0, 1, 2, … (auto-incrementing counter) |
| Text       | 1000, 1001, … (auto-incrementing counter) |
| Gizmo      | 999999 (always on top) |

### Internal Layer Structure

```typescript
// Internal representation (not exposed to consumers)
interface EzLayerInternal {
  id: string;
  type: "image" | "text";
  name?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  displayObject: Sprite | Text;     // The actual PixiJS object
  transform?: TransformState;       // Image layers only
  fitScale?: number;                // Computed fit-to-stage scale factor
  url?: string;                     // Original asset URL (cleared after first pixel upload)
}
```

### Public Layer Interface

```typescript
// Returned by getLayer() / getLayers()
interface EzLayer {
  id: string;
  type: "image" | "text";
  name?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  container: Container;             // The PixiJS display object
}
```

---

## Layer Management

```typescript
// ── Image layers ──────────────────────────────────────────────────────────
const id = await engine.addImageLayer(url);         // Load, center, fit to stage
const id = await engine.addImageLayer(url, "myId"); // Custom ID

// ── Text layers ───────────────────────────────────────────────────────────
const id = engine.addTextLayer("Hello", {
  fill: "#ffffff",
  fontSize: 64,
  fontFamily: "Arial",
  fontWeight: "bold",
  fontStyle: "italic",
});
engine.updateTextLayer(id, "New text", { fontSize: 48 });
engine.removeTextLayer(id);
engine.getAllTextLayerIds();          // → string[]
engine.getTextLayerInfo(id);         // → TextLayerInfo | null

// ── Selection ─────────────────────────────────────────────────────────────
engine.selectLayer(id);
engine.selectedLayerId;              // getter → string | null
engine.selectedLayerId = id;         // setter (emits 'selection:change')

// ── Ordering ──────────────────────────────────────────────────────────────
engine.bringToFront(id);             // maxZ + 1
engine.sendToBack(id);               // minZ - 1
engine.reorderLayer(id, 42);         // Explicit zIndex
engine.moveLayer(id, x, y);          // Set pixel position directly

// ── State ─────────────────────────────────────────────────────────────────
engine.lockLayer(id);                // Protect from destructive ops
engine.unlockLayer(id);
engine.setLayerVisible(id, false);

// ── Queries ───────────────────────────────────────────────────────────────
engine.getLayer(id);                 // → EzLayer | null
engine.getLayers();                  // → ReadonlyMap<string, EzLayer>

// ── Removal ───────────────────────────────────────────────────────────────
engine.removeLayer(id);              // Detaches gizmo if selected
engine.clearLayers();                // Removes all + clears history
```

---

## Transform System

All transform operations record undo/redo commands automatically. They operate on the currently selected image layer.

```typescript
engine.rotate(90);                   // Relative rotation in degrees
engine.setRotation(45);              // Absolute rotation
engine.flip("h");                    // Horizontal flip
engine.flip("v");                    // Vertical flip
engine.resetTransform();             // rotation=0, flip=false (keeps scale/position)
engine.scale(1.5);                   // Uniform scale
engine.scale(2, 0.5);               // Non-uniform scale

engine.transform;                    // → Readonly<TransformState> | null
```

### TransformState

```typescript
interface TransformState {
  rotation: number;    // Degrees (0-359)
  scaleX: number;      // 1 = original size
  scaleY: number;
  x: number;           // Sprite anchor X position (pixels)
  y: number;           // Sprite anchor Y position (pixels)
  flipX?: boolean;
  flipY?: boolean;
}
```

---

## Filter Pipeline

EzRen has two parallel filter systems:

### 1. Live Filters (GPU, Non-destructive)

Applied directly as PixiJS shader filters. Zero pixel-buffer cost. Fully undo/redo-able.

```typescript
const fxId = engine.filters.add(layerId, "blur", { strength: 8 });
engine.filters.update(layerId, fxId, { strength: 4 });
engine.filters.remove(layerId, fxId);
engine.filters.get(layerId);         // → LiveFilterDef[]
```

| Type | PixiJS filter | Key params |
|:-----|:-------------|:-----------|
| `"blur"` | `BlurFilter` | `strength: number` |
| `"noise"` | `NoiseFilter` | `noise: number` |
| `"color"` | `ColorMatrixFilter` | `brightness`, `contrast`, `saturation`, `hue` |
| `"adjustment"` | `AlphaFilter` | `alpha: number` |

#### ColorMatrixFilter Chaining

The `"color"` filter applies all four params in sequence with `multiply=true` so they accumulate correctly:

```
reset()               → identity matrix
brightness(b, true)   → identity × brightness
contrast(c, true)     → × contrast
saturate(s, true)     → × saturation
hue(h, true)          → × hue
```

#### Sugar API (Convenience)

```typescript
engine.setBrightness(layerId, 1.2);  // Upserts "color" filter
engine.setContrast(layerId, 1.1);    // Upserts "color" filter
engine.setSaturation(layerId, 0.8);  // Upserts "color" filter
engine.setHue(layerId, 45);          // Upserts "color" filter
engine.setBlur(layerId, 5);          // Upserts "blur" filter
engine.setOpacity(layerId, 0.7);     // Upserts "adjustment" filter
```

### 2. WASM Filters (CPU, Destructive)

Process the full pixel buffer. Records before/after snapshots for undo/redo.

```typescript
// Register a custom filter
engine.registerFilter("adjustments", (buffer: PixelBuffer) => {
  // Mutate buffer.data (RGBA Uint8Array) in place
  return buffer;
});

// Apply it (GPU → CPU → filter → GPU, records command)
await engine.applyWasmFilter("adjustments");

// Photon fallback: if no custom filter registered, calls photonModule[filterName]()
await engine.applyWasmFilter("sharpen");

// Raw pixel upload (no command recorded — preview only)
await engine.syncPixels(buffer);
```

**Pixel flow:** `renderer.extract.pixels(texture)` → `WasmFilterFn` → `BufferImageSource` → new `Texture` → sprite.

### 3. Filter Presets (Built-in CPU Filters)

High-level API for common destructive filters. No manual registration needed.

```typescript
// Apply built-in filters
await engine.presets.applyFilter("grayscale");
await engine.presets.applyFilter("sepia");
await engine.presets.applyFilter("invert");
await engine.presets.applyFilter("threshold");
await engine.presets.applyFilter("solarize");

// Register custom preset
engine.presets.registerFilter("vintage", (buf: PixelBuffer) => {
  // Process pixels...
  return buf;
});

// Query available presets
engine.presets.listFilters();  // → ["grayscale", "sepia", "invert", "threshold", "solarize"]
```

#### Built-in Filter Algorithms

| Filter | Algorithm |
|:-------|:---------|
| `grayscale` | `luma = 0.299R + 0.587G + 0.114B` (ITU-R BT.601) |
| `sepia` | W3C standard: `R' = 0.393R + 0.769G + 0.189B`, etc. |
| `invert` | `channel = 255 - channel` |
| `threshold` | `luma > 128 ? 255 : 0` |
| `solarize` | `channel > 128 ? 255 - channel : channel` |

All built-in filters mutate the `PixelBuffer` in place and return it (zero-copy pattern).

---

## Crop System

### Manual Crop

```typescript
await engine.applyCrop({ x: 100, y: 50, width: 800, height: 600 });
```

### Crop Presets

High-level API for common aspect-ratio crops. Dimensions are calculated from the active layer's **texture size** (not canvas size).

```typescript
await engine.presets.applyCrop("square");     // 1:1 centered
await engine.presets.applyCrop("landscape");  // 16:9 centered
await engine.presets.applyCrop("portrait");   // 9:16 centered
await engine.presets.applyCrop("story");      // Alias for portrait

// Register custom crop preset
engine.presets.registerCrop("banner", (width, height) => {
  const targetRatio = 3 / 1;
  const cropW = width;
  const cropH = Math.round(width / targetRatio);
  return {
    x: 0,
    y: Math.round((height - cropH) / 2),
    width: cropW,
    height: cropH,
  };
});

// Query available presets
engine.presets.listCrops();  // → ["square", "landscape", "portrait", "story"]
```

#### Built-in Crop Algorithms

| Preset | Ratio | Strategy |
|:-------|:------|:---------|
| `square` | 1:1 | Centered, uses shorter side |
| `landscape` | 16:9 | Centered, fits within bounds |
| `portrait` | 9:16 | Centered, fits within bounds |
| `story` | 9:16 | Alias for `portrait` |

---

## Resize

```typescript
await engine.resize(1920, 1080);  // Records command, uses high-quality downscale
```

---

## Pixel Operations

```typescript
// Extract a deep copy of the selected layer's pixels
const clone: PixelBuffer = await engine.cloneLayer();

// Extract ImageData (handles rotation/flip via off-screen render pass)
const imgData: ImageData | null = await engine.extractLayerImageData();

// Compute per-channel histogram (256 bins each)
const hist: HistogramData = await engine.getHistogram();
// hist.r, hist.g, hist.b, hist.lum — all Uint32Array[256]
```

---

## Command System (Undo/Redo)

`CommandManager` implements **execute-then-record** semantics:

```typescript
// CommandManager.execute(command):
async execute(command: Command): Promise<void> {
  await command.execute();     // 1. Run the action immediately
  undoStack.push(command);     // 2. Record it for undo
  redoStack = [];              // 3. Clear redo branch
}
```

### Usage

```typescript
await engine.undo();            // → boolean (false = nothing to undo)
await engine.redo();            // → boolean (false = nothing to redo)
engine.canUndo();               // → boolean
engine.canRedo();               // → boolean
engine.commandHistory;          // → readonly Command[]

// Execute a custom command
await engine.execute({
  id: crypto.randomUUID(),
  type: "transform",
  description: "custom operation",
  execute: () => { /* apply */ },
  undo: () => { /* revert */ },
});
```

### What Gets Recorded

| Operation | Command type | Snapshot strategy |
|:----------|:-------------|:------------------|
| `rotate`, `flip`, `setRotation`, `resetTransform`, `scale` | `"transform"` | Before/after `TransformState` (lightweight, numeric) |
| `applyWasmFilter` / `presets.applyFilter` | `"filter"` | Before/after `PixelBuffer` (full RGBA pixel copy) |
| `applyCrop` / `presets.applyCrop` | `"crop"` | Before/after `PixelBuffer` |
| `resize` | `"resize"` | Before/after `PixelBuffer` + scale state |
| `filters.add` | `"live-filter"` | Filter def reference (GPU state only) |
| `filters.remove` | `"live-filter"` | Filter def + PixiJS filter instance reference |
| `filters.update` | `"live-filter"` | Before/after params objects |
| Gizmo drag-end | `"transform"` | Before/after `TransformState` |

**`syncPixels()` does NOT record a command** — it is a raw preview-sync tool, not a committed edit.

**History limit:** Configured via `EzRenOptions.maxHistory` (default: 50). Oldest entries are dropped with `undoStack.shift()` when exceeded.

### Command Interface

```typescript
interface Command {
  id: string;
  type: "transform" | "filter" | "live-filter" | "crop" | "resize" | "add-layer" | "remove-layer";
  description?: string;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
  /** Called when this command is permanently removed from history. */
  dispose?(): void;
}
```

`dispose()` is called automatically by `CommandManager` when:
- A command is shifted out of the undo stack (exceeds `maxHistory`)
- The redo stack is discarded after a new `execute()`
- `clear()` is called (full history wipe)

---

## Event System

`EzRenCore` extends a typed `EventEmitter`. Designed for UI frameworks (React, Vue) to stay in sync without polling.

| Event | Payload | Trigger |
|:------|:--------|:--------|
| `"selection:change"` | `string \| null` | When a different layer is selected |
| `"history:change"` | `{ canUndo: boolean; canRedo: boolean }` | After execute, undo, redo, or clear |
| `"layer:update"` | `string` (layerId) | When a layer's visuals, transform, or pixels change |
| `"layer:add"` | `string` (layerId) | When a new layer is registered |
| `"layer:remove"` | `string` (layerId) | When a layer is deleted |

```typescript
engine.on("selection:change", (id) => {
  console.log("Selected layer:", id);
});

engine.on("history:change", ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});

engine.on("layer:update", (layerId) => {
  refreshThumbnail(layerId);
});

// Remove a specific listener
engine.off("selection:change", myListener);
```

---

## Coordinate Mapping

```typescript
// Map a canvas-space point to texture-space
const imgPt: Point | null = engine.canvasToImage(canvasX, canvasY);

// Map a canvas-space rectangle to texture-space
const texRect: Rect | null = engine.getTextureRect(canvasRect);
```

These account for sprite anchor offset, rotation, scale, and flip. Returns `null` if the point falls outside the texture bounds (with a margin).

---

## Interaction & Gizmo

`EzRenInteraction` bridges user inputs and the core. It drives the `TransformerGizmo` via the PixiJS Ticker:

```
pointerdown on layer  → selectedLayerId = id → emits "selection:change"
Ticker tick (60fps)   → TransformerGizmo.onTick()
                        → if no target: gizmo hidden
                        → else: sync gizmo position/size to match layer bounds
pointerdown on stage  → selectedLayerId = null → deselect
```

### TransformerGizmo

`TransformerGizmo extends Container` — always rendered at `zIndex: 999999`. Contains:

- **`box`** (Graphics): Border rectangle + rotation arm. Cursor: `move`. Drag action: translate.
- **4 corner handles** (`tl`, `tr`, `bl`, `br`): Scale proportionally based on distance ratio from center.
- **`rot` handle**: Rotate based on angle delta from center.

Commands are recorded **only on drag end** (`window.pointerup`), keeping the undo stack clean while the user drags. During a drag, only the `TransformState` and sprite are updated in real time.

### Gizmo Lifecycle

```typescript
gizmo.attach(layer);   // Binds target, sets visible=true, runs one tick
gizmo.attach(null);    // Clears target, sets visible=false immediately
```

**`removeLayer` and `clearLayers` both call `gizmo.attach(null)` before touching the registry.** This is critical: if the gizmo's `target` still points to a removed layer, its `eventMode = 'static'` box remains in the scene and blocks all pointer events, freezing the canvas.

### Interactivity Control

```typescript
engine.setInteractive(true);   // Enable pointer events + gizmo
engine.setInteractive(false);  // Disable pointer events + hide gizmo
```

---

## Export

```typescript
// Full scene (image + text overlays), hides gizmo automatically
const result: Blob | string = await engine.saveImage({
  format: "blob",              // or "base64" / "dataURL"
  mimeType: "image/webp",     // "image/png" | "image/jpeg" | "image/webp"
  quality: 0.9,                // 0.0 to 1.0 (lossy formats)
  dimensions: { width: 1920, height: 1080 },  // Optional downscale
  returnType: "blob",          // "blob" | "dataURL"
});

// Low-level export (does NOT hide gizmo)
const result: ExportResult = await engine.exportImage({ format: "base64" });

// Text overlays only (hides image layers temporarily)
const overlays: ExportResult = await engine.exportOverlays();
```

### ExportResult

```typescript
interface ExportResult {
  format: ExportFormat;
  data?: string | null;   // Populated when format === "base64"
  blob?: Blob;            // Populated when format === "blob"
  mimeType: string;
}
```

---

## Plugin System

Plugins receive a restricted `EzRenPluginAPI` surface — they cannot access engine internals:

```typescript
interface EzRenPluginAPI {
  readonly app: Application;
  getLayers(): ReadonlyMap<string, EzLayer>;
  getSelectedLayerId(): string | null;
  registerFilter(name: string, fn: WasmFilterFn): void;
}

const myPlugin: EzRenPlugin = {
  name: "my-plugin",
  install(api) {
    api.registerFilter("custom-blur", (buf) => {
      // Process pixels...
      return buf;
    });
  },
};

engine.use(myPlugin);  // Idempotent — duplicate installs are silently ignored
```

---

## Static Utilities

```typescript
EzRen.utils.clamp(300);            // → 255
EzRen.utils.clamp(-5);             // → 0
EzRen.utils.hexToRgb("#ff8800");   // → { r: 255, g: 136, b: 0 }
```

---

## Complete Type Exports

```typescript
import type {
  // Core
  EzRenOptions,
  EzLayer,
  Command,
  TransformState,
  PixelBuffer,
  Point,
  Rect,

  // Filters
  WasmFilterFn,
  LiveFilterType,
  LiveFilterParams,
  LiveFilterDef,
  BlurFilterParams,
  NoiseFilterParams,
  ColorFilterParams,
  AdjustmentFilterParams,

  // Text
  TextLayerStyle,
  TextLayerInfo,

  // Export
  ExportOptions,
  ExportResult,
  ExportFormat,

  // Histogram
  HistogramData,

  // Plugin
  EzRenPlugin,
  EzRenPluginAPI,

  // Events
  EzRenCoreEvents,

  // Presets
  CropPresetFn,
} from "ez-ren";
```

---

## Key Types Reference

```typescript
interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

type WasmFilterFn = (buffer: PixelBuffer) => PixelBuffer | Promise<PixelBuffer>;

type CropPresetFn = (width: number, height: number) => Rect;

interface Rect { x: number; y: number; width: number; height: number; }
interface Point { x: number; y: number; }

interface HistogramData {
  r: Uint32Array;    // 256 bins
  g: Uint32Array;
  b: Uint32Array;
  lum: Uint32Array;  // 0.299R + 0.587G + 0.114B
}
```

---

## Complete API Quick Reference

### EzRen (Facade)

```typescript
// Lifecycle
new EzRen(options: EzRenOptions)
await engine.init(): Promise<void>
engine.destroy(): void

// Events
engine.on(event, listener): this
engine.off(event, listener): this

// Selection
engine.selectedLayerId: string | null
engine.selectLayer(id): void

// Image layers
await engine.addImageLayer(url, id?): Promise<string>
engine.removeLayer(id): void
engine.clearLayers(): void

// Text layers
engine.addTextLayer(text, style?): string
engine.removeTextLayer(id): void
engine.updateTextLayer(id, text?, style?): void
engine.getAllTextLayerIds(): string[]
engine.getTextLayerInfo(id): TextLayerInfo | null

// Layer state
engine.getLayer(id): EzLayer | null
engine.getLayers(): ReadonlyMap<string, EzLayer>
engine.lockLayer(id): void
engine.unlockLayer(id): void
engine.setLayerVisible(id, visible): void
engine.moveLayer(id, x, y): void
engine.bringToFront(id): void
engine.sendToBack(id): void
engine.reorderLayer(id, zIndex): void

// Transforms
engine.rotate(degrees): void
engine.setRotation(degrees): void
engine.flip(dir: "h" | "v"): void
engine.resetTransform(): void
engine.scale(scaleX, scaleY?): void
engine.transform: Readonly<TransformState> | null

// Live GPU filters
engine.filters.add(layerId, type, params?): string
engine.filters.update(layerId, effectId, params): void
engine.filters.remove(layerId, effectId): void
engine.filters.get(layerId): LiveFilterDef[]

// Sugar API
engine.setBrightness(layerId, value): void
engine.setContrast(layerId, value): void
engine.setSaturation(layerId, value): void
engine.setHue(layerId, value): void
engine.setBlur(layerId, strength): void
engine.setOpacity(layerId, value): void

// WASM / pixel filters
engine.registerFilter(name, fn): void
await engine.applyWasmFilter(filterName): Promise<void>
await engine.syncPixels(buffer): Promise<void>

// Presets
await engine.presets.applyFilter(name): Promise<void>
await engine.presets.applyCrop(name): Promise<void>
engine.presets.registerFilter(name, fn): void
engine.presets.registerCrop(name, fn): void
engine.presets.listFilters(): string[]
engine.presets.listCrops(): string[]

// Crop / Resize / Extract
await engine.applyCrop(rect): Promise<void>
await engine.resize(width, height): Promise<void>
await engine.cloneLayer(): Promise<PixelBuffer>
await engine.extractLayerImageData(): Promise<ImageData | null>
await engine.getHistogram(): Promise<HistogramData>

// Coordinate mapping
engine.canvasToImage(x, y): Point | null
engine.getTextureRect(canvasRect): Rect | null

// Undo / Redo
await engine.undo(): Promise<boolean>
await engine.redo(): Promise<boolean>
engine.canUndo(): boolean
engine.canRedo(): boolean
engine.commandHistory: readonly Command[]
await engine.execute(command): Promise<void>

// Export
await engine.saveImage(options?): Promise<Blob | string>
await engine.exportImage(options?): Promise<ExportResult>
await engine.exportOverlays(options?): Promise<ExportResult>

// Interactivity
engine.setInteractive(enabled): void

// Plugins
engine.use(plugin): this

// Static
EzRen.utils.clamp(v): number
EzRen.utils.hexToRgb(hex): { r, g, b }

// Direct access
engine.core: EzRenCore
engine.interaction: EzRenInteraction
```

---

## Key Constraints & Conventions

- **`syncPixels(buffer)` does NOT record a command.** It is for live preview only. The owning app is responsible for history.
- **`locked` layers** are silently ignored by transforms and WASM filters. Live filter operations throw instead.
- **Pixel math** must clamp to 0-255. Use `EzRen.utils.clamp(v)`.
- **`WasmFilterFn`** should mutate `buffer.data` in-place and return the buffer. Always snapshot the source before reading neighbors (box blur pattern) to avoid corruption.
- **Texture ownership**: After the first pixel upload via `syncPixels`/`applyWasmFilter`, the original asset URL is released (`Assets.unload`) and the layer's texture is managed by EzRen. Subsequent uploads destroy the previous texture.
- **`extractLayerImageData()`** flattens rotation and flip into pixel data using an off-screen render pass. The returned `ImageData` is the "committed" image at full texture resolution.
- **Gizmo detach is mandatory before layer removal.** Always call `gizmo.attach(null)` before removing a layer. Done automatically by `removeLayer`/`clearLayers`.
- **Preset crop dimensions** are calculated from the active layer's **texture size**, not the canvas size. This ensures correct results regardless of viewport scaling.

---

## Dependencies

| Package | Version | Purpose |
|:--------|:--------|:--------|
| `pixi.js` | ^8.16.0 | WebGL/WebGPU rendering, shader filters, pixel extraction |
| `@silvia-odwyer/photon` | ^0.3.3 | WASM image processing (Rust-compiled) |

---

## Changelog

### v3.0

- **Refactor — Core/Runtime Separation:** Split engine into `EzRenCore` (headless) and `EzRenInteraction` (runtime).
- **New — EventEmitter:** `EzRenCore` emits typed events for selection, history status, and layer updates. `once()` listeners can be properly removed with `off()`. Wrapper tracking is scoped per-event so `removeAllListeners("a")` does not corrupt wrappers registered on other events.
- **New — Sugar API:** Convenience methods `setBrightness`, `setContrast`, `setSaturation`, `setHue`, `setBlur`, `setOpacity`.
- **New — PresetManager:** Built-in CPU filters (grayscale, sepia, invert, threshold, solarize) and crop presets (square, landscape, portrait, story) with Registry Pattern.
- **New — Headless Mode:** `EzRenCore` can be used in Node/WASM environments without the Ticker/Gizmo overhead.
- **Perf — Zero-Copy Filters:** Built-in CPU filters mutate the `PixelBuffer` in-place, eliminating extra `Uint8Array` allocations.
- **Fix — Sepia overflow:** Built-in CPU filters now use a `Uint8ClampedArray` view for all pixel writes, preventing modulo-256 wrap-around on `Uint8Array` buffers from PixiJS extract. Previously, sepia could produce completely wrong colours on bright pixels (e.g. 345 wrapping to 89 instead of clamping to 255).
- **Fix — FilterManager GPU memory leak:** PixiJS filter instances are now fully lifecycle-managed. Commands provide a `dispose()` hook that destroys orphaned filters when they fall off the undo stack (`maxHistory`), are discarded from the redo branch, or cleared. `clearAll()` also syncs `displayObject.filters = null` on all affected layers before destroying instances, preventing dangling references.
- **New — `Command.dispose()` lifecycle hook:** Optional method on the `Command` interface, called by `CommandManager` whenever a command is permanently removed from history. Enables resource cleanup for commands that hold non-GC-able references (GPU filters, textures, etc.).
- **Fix — FilterManager double-execution:** `addEffect`, `removeEffect`, and `updateEffect` no longer apply the action immediately before recording the command. The command's `execute()` is now the sole executor, eliminating the fragile dedup-guard pattern.
- **Fix — `setInteractive(false)` now disables all layers:** Previously only image layers had their `eventMode` toggled; text layers remained clickable.
- **Fix — Crop Dimensions:** `applyPresetCrop` sizes constraints from `texture.orig.width/height`, resolving coordinate distortions from sprite scaling.
- **Cleanup — Removed legacy code:** Deleted `src/core/interaction/` (dead InteractionManager + TransformerGizmo copies, ~300 lines).
- **Cleanup — Removed unused dependencies:** `@pixi/filter-adjustment` and `@pixi/filter-color-matrix` (PixiJS v7 packages, not used in v8).
- **Cleanup — `CropPresetFn` exported:** Now available from the public API surface (`import type { CropPresetFn } from "ez-ren"`).

### v2.5

- **Fix — ColorMatrixFilter chaining (`FilterManager`):** All color operations now use `multiply=true` so they accumulate instead of replacing each other.
- **Fix — Gizmo frozen after `removeLayer`:** `removeLayer` now calls `gizmo.attach(null)` before removing the layer.
- **Fix — Gizmo frozen after `clearLayers`:** Same pattern applied.

### v2.0

- Replaced monolithic `EzRen.ts` with Facade + Managers architecture.
- Added `CommandManager` with execute-then-record undo/redo semantics.
- Added `FilterManager` for non-destructive GPU live filters.
- Added `TransformerGizmo` with move, scale, and rotate handles.
- Added `PluginManager` with restricted `EzRenPluginAPI` surface.
- Unified scene graph with `sortableChildren` and zIndex ordering.

---

## Known Limitations

- **Gizmo zoom assumption**: Assumes stage scale 1:1. Multi-level zoom requires `parent.toLocal()` coordinate remapping.
- **No group layers**: `EzLayer.type` supports `"image" | "text"`. Group containers not yet implemented.
- **No unit tests**: Coverage is 0%. Manual testing against test benches.
- **Touch / multi-touch**: Basic touch works through PixiJS events; pinch-to-zoom not implemented.
- **Text layer commands**: Moving text via gizmo records commands, but `addTextLayer`/`removeTextLayer` do not.
- **SVG layers**: Not supported. All content must be raster.
