# Undo / Redo & History

EzRen implements a full **Command pattern** undo/redo system. Every destructive operation — transforms, pixel filters, crops, and resizes — is recorded automatically with both an `execute` and `undo` function.

---

## Basic Usage

```typescript
await engine.undo(); // → boolean (false = nothing to undo)
await engine.redo(); // → boolean (false = nothing to redo)

engine.canUndo();    // → boolean
engine.canRedo();    // → boolean

engine.commandHistory; // → readonly Command[]
```

### Keeping UI in Sync

Listen to the `history:change` event to update your UI buttons reactively:

```typescript
engine.on("history:change", ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});
```

---

## What Gets Recorded

| Operation | Command Type | Snapshot Strategy |
|:----------|:-------------|:------------------|
| `rotate`, `flip`, `setRotation`, `resetTransform`, `scale` | `"transform"` | Before/after `TransformState` (lightweight, numeric) |
| `applyWasmFilter` / `presets.applyFilter` | `"filter"` | Before/after full `PixelBuffer` (RGBA copy) |
| `applyCrop` / `presets.applyCrop` | `"crop"` | Before/after full `PixelBuffer` |
| `resize` | `"resize"` | Before/after `PixelBuffer` + scale state |
| `filters.add` | `"live-filter"` | Filter definition reference |
| `filters.remove` | `"live-filter"` | Filter definition + PixiJS filter instance |
| `filters.update` | `"live-filter"` | Before/after params objects |
| Gizmo drag-end | `"transform"` | Before/after `TransformState` |

> **`syncPixels()` does NOT record a command.** It is a raw preview-sync tool, not a committed edit.

---

## History Limit

The undo stack is bounded by `EzRenOptions.maxHistory` (default: `50`). When exceeded, the oldest entries are dropped and their `dispose()` method is called (freeing any `PixelBuffer` references):

```typescript
const engine = new EzRen({
  canvas,
  maxHistory: 100, // increase for power-user workflows
});
```

---

## Custom Commands

You can push any custom operation into the history stack using `engine.execute()`:

```typescript
await engine.execute({
  id: crypto.randomUUID(),
  type: "transform", // or "filter", "crop", "resize", "live-filter", etc.
  description: "My custom operation",

  execute: () => {
    // Apply the action
  },

  undo: () => {
    // Revert the action
  },

  dispose: () => {
    // Optional: free resources when this command is evicted from history
  },
});
```

The `Command` interface in full:

```typescript
interface Command {
  id: string;
  type: "transform" | "filter" | "live-filter" | "crop" | "resize" | "add-layer" | "remove-layer";
  description?: string;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
  dispose?(): void; // Called when evicted from history or on clearLayers()
}
```

---

## How `CommandManager` Works

The execute-then-record flow:

```
CommandManager.execute(command)
  1. command.execute()      → Apply the action immediately
  2. undoStack.push(command) → Record for undo
  3. redoStack = []          → Clear the redo branch
```

When `undo()` is called:

```
  1. command = undoStack.pop()
  2. command.undo()
  3. redoStack.push(command)
  4. emit "history:change"
```

`dispose()` is called automatically when:
- A command is shifted off the undo stack (due to `maxHistory` limit)
- The redo stack is discarded after a new `execute()`
- `clearLayers()` is called (full history wipe)
