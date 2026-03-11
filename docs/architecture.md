# Architecture

This document explains the internal design of EzRen — why it is split the way it is, and how the different subsystems relate to each other.

---

## Design Philosophy

EzRen is built around three principles:

1. **Separation of concerns** — The headless core is completely decoupled from any browser interaction logic.
2. **Command-sourced undo/redo** — Every mutation goes through the `CommandManager`, ensuring history is always consistent.
3. **Minimal allocations** — Pixel operations use in-place mutation and typed arrays (`Uint8Array`, `Uint8ClampedArray`) to minimize GC pressure.

---

## The Two-Layer Architecture

```
EzRen (Facade — batteries-included)
├── EzRenCore    (Nucleus — Headless)
│   ├── RenderSystem     — PixiJS Application, canvas lifecycle, pixel extraction
│   ├── LayerManager     — Scene graph registry and transform sync
│   ├── CommandManager   — Undo/redo stack and history events
│   ├── FilterManager    — GPU live-filter pipeline (non-destructive)
│   ├── PresetManager    — Built-in CPU filters and aspect-ratio crops
│   └── PluginManager    — Third-party plugin installation (sandboxed API)
└── EzRenInteraction  (Runtime — Interactive only)
    └── TransformerGizmo — Drag handles for translate, scale, rotate
```

### `EzRenCore` — The Nucleus

`EzRenCore` is the **headless engine**. It has zero dependencies on pointer events, DOM interaction, or the `TransformerGizmo`. It initializes a PixiJS `Application`, manages all layers, applies filters, and manages the undo/redo stack.

It can be instantiated completely independently:

```typescript
import { EzRenCore } from "ez-ren";

const core = new EzRenCore({ canvas, backgroundColor: 0x000000 });
await core.init();
// Full rendering + filter + command system, no UI
```

### `EzRenInteraction` — The Runtime

`EzRenInteraction` holds the `TransformerGizmo` and all pointer event logic. It depends on `EzRenCore` — it reads the selected layer ID from the core and attaches/detaches the gizmo accordingly.

Commands triggered by gizmo drag actions are executed through `core.commands.execute()`, keeping the undo stack consistent whether the action comes from the API or the user's mouse.

### `EzRen` — The Facade

`EzRen` is a thin composition class that wires `EzRenCore` and `EzRenInteraction` together and re-exports all methods. This is the class most consumers should use.

---

## Scene Graph

All layers live in a single `sceneContainer` with `sortableChildren = true`. Render order is controlled by `zIndex`:

| Layer type | Default z-index |
|:-----------|:----------------|
| Image | `0, 1, 2, …` (auto-incrementing) |
| Text | `1000, 1001, …` (always above images) |
| Gizmo | `999999` (always on top) |

---

## The Filter Pipeline

EzRen has two parallel filter systems that operate independently:

```
GPU Live Filters (non-destructive)
  → PixiJS shader filters applied to the Sprite/Texture in real time
  → Zero pixel-buffer cost
  → Commands recorded for add/remove/update

CPU Pixel Filters (destructive)
  → renderer.extract.pixels(texture) → Uint8Array (read from GPU)
  → WasmFilterFn(buffer) mutates buffer.data in place
  → BufferImageSource → new Texture → sprite.texture = newTex (upload to GPU)
  → Before/after PixelBuffer snapshots stored in undo command
```

The CPU pixel flow is:

```
GPU texture → extract to CPU buffer
  → Custom filter fn (or Photon WASM)
    → Upload back to GPU as new texture
      → Record before/after for undo
```

---

## The Command Pattern

```
CommandManager.execute(command):
  1. await command.execute()   → Apply the action
  2. undoStack.push(command)   → Record for undo
  3. redoStack = []            → Invalidate redo branch

CommandManager.undo():
  1. command = undoStack.pop()
  2. await command.undo()
  3. redoStack.push(command)
  4. emit "history:change"

CommandManager.redo():
  1. command = redoStack.pop()
  2. await command.execute()   → Re-apply
  3. undoStack.push(command)
  4. emit "history:change"
```

Lightweight operations (transforms) store only a `TransformState` object (7 numbers). Expensive operations (filters, crops, resizes) store full `PixelBuffer` copies. The `dispose()` hook on each command frees those copies when evicted from history.

---

## File Layout

```
src/
  EzRen.ts                        # Facade (EzRenCore + EzRenInteraction)
  types.ts                        # All exported interfaces and types
  index.ts                        # Package entry point

  core/
    EzRenCore.ts                  # Headless nucleus
    EventEmitter.ts               # Typed event system

    rendering/
      RenderSystem.ts             # PixiJS app setup, pixel extract, export

    managers/
      LayerManager.ts             # Layer registry and transform sync
      CommandManager.ts           # Undo/redo stack
      FilterManager.ts            # GPU live filter pipeline
      PresetManager.ts            # Built-in filter and crop presets
      PluginManager.ts            # Plugin installer (sandboxed API)

  runtime/
    EzRenInteraction.ts           # Pointer events and selection
    gizmo/
      TransformerGizmo.ts         # Drag handles (PixiJS Container)
```

---

## Performance Considerations

- **Minimal GC pressure**: Pixel filters mutate in-place (`Uint8Array`) rather than allocating new arrays on every operation.
- **GPU first**: Live filters stay on the GPU shader pipeline and never touch the CPU pixel buffer.
- **Lazy snapshots**: Undo snapshots for pixel operations are captured only when the operation is committed, not during preview.
- **`syncPixels` for previews**: Preview changes (such as live slider feedback before committing) use `syncPixels()`, which does not record a command or allocate a snapshot.
- **History disposal**: `PixelBuffer` references in old commands are explicitly freed via `dispose()` when the command leaves the history window.
