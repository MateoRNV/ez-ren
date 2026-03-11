# EzRen

**GPU-powered image editing engine for the browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![PixiJS](https://img.shields.io/badge/PixiJS-v8-red.svg)](https://pixijs.com/)

EzRen is a framework-agnostic, headless-capable image editing engine built on top of **PixiJS v8 (WebGL/WebGPU)**. It is designed to give developers a clean, powerful TypeScript API for building browser-based image editing tools — without having to deal with shader pipelines, canvas management, coordinate mapping, or undo/redo stacks.

> **EzRen is not a UI editor. It is an engine to build editors.**

---

## What Problems Does EzRen Solve?

Building an in-browser image editor from scratch is surprisingly complex:

- Setting up a WebGL rendering context and keeping it in sync with the DOM
- Implementing a real-time, non-destructive filter pipeline
- Managing undo/redo for both lightweight transforms and expensive pixel operations
- Handling coordinate mapping between canvas space and texture space
- Supporting drag handles, selection, rotation, and scaling with pointer events

**EzRen handles all of this**, so you can focus on building your product.

---

## What Can You Build With EzRen?

- 🖼 Online photo editors
- 💬 Meme generators
- 📱 Social media image croppers
- ✏️ Image annotation tools
- 📦 Batch image processing pipelines

> **[EzStudio](https://github.com/MateoRNV/ez-studio)** is the official reference implementation built with EzRen — a fully-featured browser editor that demonstrates what is possible.

---

## Features

- **Layer system** — Image and text layers with full z-order control
- **Transform tools** — Rotate, scale, flip, with drag-and-drop gizmo handles
- **GPU live filters** — Non-destructive, real-time color, blur, and opacity adjustments via shader pipeline
- **CPU / WASM destructive filters** — Pixel-level operations (grayscale, sepia, invert, threshold, solarize) with full undo support
- **Crop & resize** — Manual or aspect-ratio presets (1:1, 16:9, 9:16)
- **Undo / Redo** — Command pattern with configurable history depth
- **Export** — PNG, JPG, WebP as `Blob` or `base64`
- **Event system** — Typed event emitter to keep UI frameworks in sync
- **Plugin architecture** — Extend the engine with custom filters and crop presets
- **Headless mode** — Run the core without a browser window (workers, server-side, batch jobs)

---

## Installation

```bash
npm install ez-ren
```

```bash
# or
yarn add ez-ren
pnpm add ez-ren
```

---

## Quick Start

```typescript
import { EzRen } from "ez-ren";

// 1. Create the engine and bind it to a canvas
const engine = new EzRen({
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
  backgroundColor: 0x1a1a2e,
  maxHistory: 50,
});

// 2. Initialize (loads PixiJS renderer)
await engine.init();

// 3. Load an image
const layerId = await engine.addImageLayer("./photo.jpg");

// 4. Apply a live GPU filter (non-destructive, real-time)
engine.setBrightness(layerId, 1.2);
engine.setSaturation(layerId, 0.8);

// 5. Apply a pixel-level preset filter (destructive, undoable)
await engine.presets.applyFilter("sepia");

// 6. Crop to square
await engine.presets.applyCrop("square");

// 7. Export as PNG blob
const blob = await engine.saveImage({ mimeType: "image/png", returnType: "blob" });
```

---

## Architecture: Core vs Runtime

EzRen uses a clean two-layer architecture. The `EzRen` facade class composes both for convenience.

```
EzRen (Facade — full browser experience)
├── EzRenCore    (Nucleus — Headless)
│   ├── RenderSystem     — PixiJS application, canvas, pixel extraction
│   ├── LayerManager     — Scene graph registry and transform sync
│   ├── CommandManager   — Undo/redo stack and history events
│   ├── FilterManager    — GPU live-filter pipeline (non-destructive)
│   ├── PresetManager    — Built-in CPU filters and crop presets
│   └── PluginManager    — Third-party extensions
└── EzRenInteraction  (Runtime — Interactive)
    └── TransformerGizmo — Visual handles for drag, scale, and rotate
```

### Import Modes

| Mode | Import | Use case |
|:-----|:-------|:---------|
| **Full interactive** | `import { EzRen } from "ez-ren"` | Browser editor with gizmo and pointer events |
| **Headless core** | `import { EzRenCore } from "ez-ren"` | Server-side, batch processing, workers |
| **Custom runtime** | `import { EzRenCore, EzRenInteraction } from "ez-ren"` | Build your own interaction layer |

### Headless Usage

```typescript
import { EzRenCore } from "ez-ren";

const core = new EzRenCore({ canvas, backgroundColor: 0x000000 });
await core.init();

const id = await core.addImageLayer("photo.jpg");
await core.applyWasmFilter("grayscale");

const blob = await core.saveImage({ returnType: "blob" });
```

---

## Filter Pipeline

EzRen exposes two complementary filter systems:

### 1. GPU Live Filters — Non-destructive, real-time

Applied as PixiJS shader filters. Zero pixel-buffer cost. Fully undoable.

```typescript
// Sugar API (recommended for most use cases)
engine.setBrightness(layerId, 1.2);
engine.setContrast(layerId, 1.1);
engine.setSaturation(layerId, 0.8);
engine.setHue(layerId, 45);
engine.setBlur(layerId, 5);
engine.setOpacity(layerId, 0.9);

// Low-level filter API
const fxId = engine.filters.add(layerId, "color", { brightness: 1.2, contrast: 1.1 });
engine.filters.update(layerId, fxId, { saturation: 0.8 });
engine.filters.remove(layerId, fxId);
```

### 2. Pixel Filters — Destructive, undoable

Operate on the raw pixel buffer. Before/after snapshots are stored automatically for undo.

```typescript
// Built-in preset filters
await engine.presets.applyFilter("grayscale");
await engine.presets.applyFilter("sepia");
await engine.presets.applyFilter("invert");
await engine.presets.applyFilter("threshold");
await engine.presets.applyFilter("solarize");

// Register and apply a custom filter
engine.presets.registerFilter("vintage", (buffer) => {
  // Mutate buffer.data (Uint8Array — RGBA) in place
  return buffer;
});
await engine.presets.applyFilter("vintage");
```

---

## Events

EzRen exposes a typed event system so UI frameworks like React and Vue can stay in sync with the engine without polling.

```typescript
engine.on("selection:change", (layerId) => {
  console.log("Selected:", layerId);
});

engine.on("history:change", ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});

engine.on("layer:update", (layerId) => {
  refreshLayerThumbnail(layerId);
});
```

| Event | Payload | Description |
|:------|:--------|:------------|
| `selection:change` | `string \| null` | Layer selection changed |
| `history:change` | `{ canUndo, canRedo }` | Undo/redo state updated |
| `layer:update` | `string` | Layer pixels, transform, or properties changed |
| `layer:add` | `string` | A new layer was added |
| `layer:remove` | `string` | A layer was deleted |

---

## Plugin System

Extend EzRen with custom filters or crop presets via a restricted, safe plugin API.

```typescript
import type { EzRenPlugin } from "ez-ren";

const myPlugin: EzRenPlugin = {
  name: "my-plugin",
  install(api) {
    api.registerFilter("neon", (buffer) => {
      // Custom pixel processing...
      return buffer;
    });
  },
};

engine.use(myPlugin);
```

---

## Documentation

| Guide | Description |
|:------|:------------|
| [Getting Started](./docs/getting-started.md) | Installation, initialization, and first image |
| [Layer System](./docs/layers.md) | Image/text layers, selection, z-ordering |
| [Filters](./docs/filters.md) | GPU live filters and CPU pixel filters |
| [Transforms](./docs/transforms.md) | Rotate, flip, scale, gizmo interaction |
| [Presets](./docs/presets.md) | Built-in and custom filter & crop presets |
| [Exporting](./docs/exporting.md) | PNG, JPG, WebP, blob, base64, pixel extraction |
| [Undo / Redo](./docs/undo-redo.md) | Command system, history, custom commands |
| [Events](./docs/events.md) | Typed event emitter, React integration patterns |
| [Plugins](./docs/plugins.md) | Extending the engine with custom plugins |
| [Architecture](./docs/architecture.md) | Core vs Runtime, scene graph, filter pipeline |
| [API Reference](./docs/api-reference.md) | Complete type and method reference |

---

## Contributing

Contributions are welcome. If you want to add a new feature, fix a bug, or improve performance:

1. **Fork the repository**
2. **Create a feature branch:**
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Commit your changes:**
   ```bash
   git commit -m "Add new feature"
   ```
4. **Push to your branch:**
   ```bash
   git push origin feature/my-feature
   ```
5. **Open a Pull Request**

Please make sure your changes include relevant TypeScript types and do not break existing API contracts.

---

## License

This project is licensed under the MIT License.
See the [LICENSE](LICENSE) file for details.
