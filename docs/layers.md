# Layer System

Layers are the fundamental building blocks of EzRen. Every image and text element you add to the canvas lives as a layer in the scene graph. EzRen manages z-ordering, transforms, visibility, locking, and selection for you.

---

## Layer Types

| Type | Created by | Stores |
|:-----|:-----------|:-------|
| `"image"` | `addImageLayer()` | Sprite texture, transform state |
| `"text"` | `addTextLayer()` | PixiJS Text object, style |

---

## Adding Layers

### Image Layers

```typescript
// Load from URL, blob URL, or data URL
const id = await engine.addImageLayer("./photo.jpg");
const id = await engine.addImageLayer(blobUrl);

// Provide a custom ID
const id = await engine.addImageLayer("./photo.jpg", "my-background");
```

The image is automatically centered and scaled to fit the canvas stage.
The first image added becomes the active (selected) layer automatically.

### Text Layers

```typescript
const id = engine.addTextLayer("Hello, World!", {
  fill: "#ffffff",
  fontSize: 64,
  fontFamily: "Arial",
  fontWeight: "bold",
  fontStyle: "italic",
});
```

Text layers are always rendered on top of image layers (`zIndex` starting at `1000`).

---

## The `EzLayer` Interface

All read operations return an `EzLayer` object:

```typescript
interface EzLayer {
  id: string;
  type: "image" | "text";
  name?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  container: Container; // The underlying PixiJS display object
}
```

---

## Querying Layers

```typescript
// Get a single layer by ID
const layer = engine.getLayer(id); // → EzLayer | null

// Get all layers as a readonly Map
const all = engine.getLayers(); // → ReadonlyMap<string, EzLayer>

// Iterate all layers
for (const [id, layer] of engine.getLayers()) {
  console.log(id, layer.type, layer.zIndex);
}
```

---

## Selection

Only one layer can be selected at a time. The selected layer is the target for transform operations, filter applications, crop, and resize.

```typescript
engine.selectLayer(id);            // Selects a layer (emits "selection:change")
engine.selectedLayerId;            // → string | null (current selection)
engine.selectedLayerId = id;       // Setter — also emits "selection:change"
engine.selectedLayerId = null;     // Deselect
```

Listen for selection changes to keep your UI in sync:

```typescript
engine.on("selection:change", (layerId) => {
  propertiesPanel.update(layerId);
});
```

---

## Layer State

```typescript
engine.lockLayer(id);              // Protect from destructive edits
engine.unlockLayer(id);
engine.setLayerVisible(id, false); // Hide without removing
engine.setLayerVisible(id, true);
```

Locked layers silently ignore transform and filter operations. This is useful to protect a background while editing overlays.

---

## Ordering (Z-Index)

```typescript
engine.bringToFront(id);           // Move to highest z-index
engine.sendToBack(id);             // Move to lowest z-index
engine.reorderLayer(id, 42);       // Set explicit z-index
engine.moveLayer(id, x, y);        // Set pixel position (anchor center)
```

Default z-index assignment:

| Layer type | Default z-index range |
|:-----------|:----------------------|
| Image | `0, 1, 2, …` (auto-incrementing) |
| Text | `1000, 1001, …` (always above images) |
| Gizmo | `999999` (always on top) |

---

## Text Layer Operations

```typescript
// Update text content or style
engine.updateTextLayer(id, "New text", { fontSize: 48, fill: "#ffcc00" });

// Remove a text layer
engine.removeTextLayer(id);

// Get all text layer IDs
const textIds = engine.getAllTextLayerIds(); // → string[]

// Get layer info (text + style + position)
const info = engine.getTextLayerInfo(id);
// → { id, text, x, y, style: { fill, fontSize, fontFamily, fontWeight, fontStyle } }
```

---

## Removing Layers

```typescript
engine.removeLayer(id);   // Removes any layer by ID, deselects if active
engine.clearLayers();     // Removes all layers + resets undo/redo history
```

---

## Events

| Event | When |
|:------|:-----|
| `layer:add` | A new layer was registered |
| `layer:remove` | A layer was deleted |
| `layer:update` | A layer's pixels, transform, or properties changed |
| `selection:change` | The active selection changed |

```typescript
engine.on("layer:add", (id) => renderLayerList());
engine.on("layer:remove", (id) => renderLayerList());
engine.on("layer:update", (id) => updateThumbnail(id));
```
