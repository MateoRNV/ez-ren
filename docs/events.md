# Events

EzRen extends a typed `EventEmitter` that allows your UI layer (React, Vue, Svelte, vanilla JS) to stay in sync with the engine **without polling**.

---

## Event Catalogue

| Event | Payload | When it fires |
|:------|:--------|:--------------|
| `"selection:change"` | `string \| null` | A different layer was selected (or deselected) |
| `"history:change"` | `{ canUndo: boolean; canRedo: boolean }` | After `execute`, `undo`, `redo`, or `clearLayers` |
| `"layer:update"` | `string` (layerId) | A layer's pixels, transform, or properties changed |
| `"layer:add"` | `string` (layerId) | A new layer was registered |
| `"layer:remove"` | `string` (layerId) | A layer was deleted |

---

## Subscribing and Unsubscribing

```typescript
// Subscribe
const onSelectionChange = (id: string | null) => {
  console.log("Selected layer:", id);
};
engine.on("selection:change", onSelectionChange);

// Unsubscribe
engine.off("selection:change", onSelectionChange);
```

---

## Common Patterns

### Drive undo/redo button state

```typescript
engine.on("history:change", ({ canUndo, canRedo }) => {
  undoBtn.disabled = !canUndo;
  redoBtn.disabled = !canRedo;
});
```

### Refresh the layer panel

```typescript
function renderLayerList() {
  const layers = [...engine.getLayers().values()];
  // re-render your UI list here
}

engine.on("layer:add",    () => renderLayerList());
engine.on("layer:remove", () => renderLayerList());
engine.on("layer:update", () => renderLayerList());
```

### Update the properties panel on selection

```typescript
engine.on("selection:change", (layerId) => {
  if (!layerId) {
    propertiesPanel.hide();
    return;
  }
  const layer = engine.getLayer(layerId);
  const transform = engine.transform;
  propertiesPanel.update(layer, transform);
});
```

### Refresh layer thumbnails

```typescript
engine.on("layer:update", (layerId) => {
  refreshThumbnail(layerId);
});
```

---

## React Integration Example

```tsx
import { useEffect, useState } from "react";

function useEzRenHistory(engine: EzRen) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  useEffect(() => {
    const handler = ({ canUndo, canRedo }: { canUndo: boolean; canRedo: boolean }) => {
      setCanUndo(canUndo);
      setCanRedo(canRedo);
    };
    engine.on("history:change", handler);
    return () => engine.off("history:change", handler);
  }, [engine]);

  return { canUndo, canRedo };
}
```

```tsx
function useSelectedLayer(engine: EzRen) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    engine.on("selection:change", setSelectedId);
    return () => engine.off("selection:change", setSelectedId);
  }, [engine]);

  return selectedId;
}
```
