# Transforms

EzRen provides a full transform system for image layers: rotation, flipping, scaling, and free positioning. All transform operations are automatically recorded to the undo/redo stack.

> **Note:** Transforms apply to the currently **selected** image layer. If no image layer is selected, transform calls will throw an error.

---

## Rotate

```typescript
engine.rotate(90);          // Relative: add 90° to current rotation
engine.rotate(-90);         // Rotate counter-clockwise
engine.setRotation(45);     // Absolute: set rotation to exactly 45°
```

Quick rotate shortcuts are a common pattern in editors:

```typescript
document.getElementById("btn-cw").addEventListener("click", () => engine.rotate(90));
document.getElementById("btn-ccw").addEventListener("click", () => engine.rotate(-90));
document.getElementById("btn-180").addEventListener("click", () => engine.rotate(180));
```

---

## Flip

```typescript
engine.flip("h"); // Flip horizontally (mirror left-right)
engine.flip("v"); // Flip vertically (mirror top-bottom)
```

Flip is a toggle — calling it twice returns to the original orientation.

---

## Scale

```typescript
engine.scale(1.5);        // Uniform scale (1.5x both axes)
engine.scale(2, 0.5);     // Non-uniform scale (2x wide, 0.5x tall)
```

Scale must be greater than `0`. Passing `0` or a negative value throws a `RangeError`.

---

## Reset

```typescript
engine.resetTransform();
// Resets rotation to 0° and flips to false.
// Does NOT reset scale or position.
```

---

## Reading the Current Transform

```typescript
const t = engine.transform;
// Returns Readonly<TransformState> | null if no image layer is selected

if (t) {
  console.log(t.rotation); // Degrees (0-359)
  console.log(t.scaleX);   // 1.0 = original
  console.log(t.scaleY);
  console.log(t.x);        // Pixel position (anchor center)
  console.log(t.y);
  console.log(t.flipX);    // boolean
  console.log(t.flipY);    // boolean
}
```

`TransformState` is a plain object — read-only snapshot. Modifying it does nothing. Use the API methods to apply changes.

---

## Position

Move a layer to an explicit position:

```typescript
engine.moveLayer(id, x, y);
// Sets the sprite's anchor-center to (x, y) in canvas-space pixels
```

This does not record an undo command — it is designed for programmatic positioning (e.g., centering, alignment, or gizmo dragging).

---

## Gizmo Interaction

When using `EzRen` (full interactive mode), the `TransformerGizmo` handles drag, scale, and rotate via pointer events. Commands are recorded **only on pointer release (`pointerup`)** to keep the undo stack clean during active drags.

The gizmo auto-attaches to the selected layer and detaches cleanly when the layer is deselected or removed.

```typescript
engine.setInteractive(true);   // Enable gizmo + pointer events
engine.setInteractive(false);  // Disable gizmo + pointer events
```

---

## Coordinate Mapping

When you need to map canvas coordinates to texture-space (e.g., for custom crop tools or annotations):

```typescript
// Map a single point: canvas space → texture space
const imgPt = engine.canvasToImage(canvasX, canvasY);
// → Point { x, y } or null if outside texture bounds

// Map a rectangle: canvas space → texture space
const texRect = engine.getTextureRect({ x, y, width, height });
// → Rect { x, y, width, height } or null
```

These methods account for the layer's rotation, scale, flip, and anchor offset.
