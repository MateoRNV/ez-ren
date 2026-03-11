# Getting Started

This guide walks you through installing EzRen, initializing the engine, and loading your first image.

---

## Installation

```bash
npm install ez-ren
# or
yarn add ez-ren
pnpm add ez-ren
```

EzRen requires a bundler that supports **ESM** (Vite, Webpack 5, esbuild, Rollup).
It is not designed for direct `<script>` tag usage without a build step.

---

## Minimal Setup

### 1. Add a canvas to your HTML

```html
<canvas id="editor" width="1200" height="800"></canvas>
```

### 2. Initialize the engine

```typescript
import { EzRen } from "ez-ren";

const engine = new EzRen({
  canvas: document.getElementById("editor") as HTMLCanvasElement,
  backgroundColor: 0x1a1a2e, // dark background (optional)
  resolution: window.devicePixelRatio, // HiDPI support (optional)
  antialias: true, // optional, default: true
  maxHistory: 50, // undo/redo stack size (optional, default: 50)
});

await engine.init();
```

> `engine.init()` loads the PixiJS WebGL/WebGPU renderer and the Photon WASM module.
> Always `await` it before calling any other method.

### 3. Load an image

```typescript
// From a URL
const layerId = await engine.addImageLayer("./my-photo.jpg");

// From a File input
const file = fileInput.files[0];
const blobUrl = URL.createObjectURL(file);
const layerId = await engine.addImageLayer(blobUrl);
```

The image is automatically centered and scaled to fit the canvas.
The returned `layerId` is a string you use to reference this layer in all subsequent operations.

---

## Choosing an Import Mode

EzRen exports three classes. Use the one that fits your use case:

| Import | Class | When to Use |
|:-------|:------|:------------|
| `import { EzRen } from "ez-ren"` | `EzRen` | Browser editor with pointer events and gizmo handles |
| `import { EzRenCore } from "ez-ren"` | `EzRenCore` | Headless processing (batch jobs, workers, server-side) |
| `import { EzRenCore, EzRenInteraction } from "ez-ren"` | Both | Build a custom interaction layer on top of the core |

---

## Headless / Serverless Mode

`EzRenCore` runs the full rendering and filter pipeline without any pointer events, selection gizmo, or browser-specific interaction code.

```typescript
import { EzRenCore } from "ez-ren";

const core = new EzRenCore({ canvas, backgroundColor: 0x000000 });
await core.init();

const id = await core.addImageLayer("photo.jpg");
await core.applyWasmFilter("grayscale");

const blob = await core.saveImage({ mimeType: "image/png", returnType: "blob" });
```

This is ideal for use in a **Web Worker**, **Node.js** (with a canvas polyfill), or any scenario where you want programmatic control without UI.

---

## Teardown

Always call `destroy()` when you no longer need the engine to free GPU resources and event listeners:

```typescript
engine.destroy();
```

---

## What's Next?

- [Layer System →](./layers.md)
- [Filters →](./filters.md)
- [Presets →](./presets.md)
- [Exporting →](./exporting.md)
- [Core API Reference →](./core-api.md)
