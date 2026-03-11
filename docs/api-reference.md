# API Reference

Complete reference for all public methods and properties on `EzRen` (the main facade class).

For headless usage, `EzRenCore` exposes the same API minus the gizmo and interaction methods.

---

## Lifecycle

```typescript
new EzRen(options: EzRenOptions)

await engine.init(): Promise<void>
// Initializes PixiJS renderer + loads Photon WASM module.
// Must be awaited before calling any other method.

engine.destroy(): void
// Full teardown: layers, filters, history, renderer, event listeners.
```

### `EzRenOptions`

```typescript
interface EzRenOptions {
  canvas: HTMLCanvasElement;       // Required
  backgroundColor?: number;        // Default: 0x1a1a2e
  resolution?: number;             // Default: window.devicePixelRatio
  antialias?: boolean;             // Default: true
  maxHistory?: number;             // Default: 50 (undo/redo stack size)
}
```

---

## Events

```typescript
engine.on(event, listener): this
engine.off(event, listener): this
```

| Event | Payload |
|:------|:--------|
| `"selection:change"` | `string \| null` |
| `"history:change"` | `{ canUndo: boolean; canRedo: boolean }` |
| `"layer:update"` | `string` (layerId) |
| `"layer:add"` | `string` (layerId) |
| `"layer:remove"` | `string` (layerId) |

---

## Selection

```typescript
engine.selectedLayerId: string | null  // getter + setter
engine.selectLayer(id: string): void
```

---

## Image Layers

```typescript
await engine.addImageLayer(url: string, id?: string): Promise<string>
engine.removeLayer(id: string): void
engine.clearLayers(): void                    // Removes all + clears history
```

---

## Text Layers

```typescript
engine.addTextLayer(text: string, style?: TextLayerStyle): string
engine.removeTextLayer(id: string): void
engine.updateTextLayer(id: string, text?: string, style?: TextLayerStyle): void
engine.getAllTextLayerIds(): string[]
engine.getTextLayerInfo(id: string): TextLayerInfo | null
```

### `TextLayerStyle`

```typescript
interface TextLayerStyle {
  fill?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
}
```

### `TextLayerInfo`

```typescript
interface TextLayerInfo {
  id: string;
  text: string;
  x: number;
  y: number;
  style: TextLayerStyle;
}
```

---

## Layer State

```typescript
engine.getLayer(id: string): EzLayer | null
engine.getLayers(): ReadonlyMap<string, EzLayer>
engine.lockLayer(id: string): void
engine.unlockLayer(id: string): void
engine.setLayerVisible(id: string, visible: boolean): void
engine.moveLayer(id: string, x: number, y: number): void
engine.bringToFront(id: string): void
engine.sendToBack(id: string): void
engine.reorderLayer(id: string, zIndex: number): void
```

### `EzLayer`

```typescript
interface EzLayer {
  id: string;
  type: "image" | "text";
  name?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  container: Container;  // PixiJS display object
}
```

---

## Transforms

> Operate on the currently selected image layer.  
> All operations record to the undo stack automatically.

```typescript
engine.rotate(degrees: number): void           // Relative rotation
engine.setRotation(degrees: number): void      // Absolute rotation
engine.flip(dir: "h" | "v"): void
engine.resetTransform(): void                  // Resets rotation + flip (not scale/position)
engine.scale(scaleX: number, scaleY?: number): void

engine.transform: Readonly<TransformState> | null
```

### `TransformState`

```typescript
interface TransformState {
  rotation: number;    // Degrees (0–359)
  scaleX: number;
  scaleY: number;
  x: number;           // Anchor center X in canvas pixels
  y: number;           // Anchor center Y in canvas pixels
  flipX?: boolean;
  flipY?: boolean;
}
```

---

## GPU Live Filters

```typescript
engine.filters.add(layerId: string, type: LiveFilterType, params?: LiveFilterParams): string
engine.filters.update(layerId: string, effectId: string, params: LiveFilterParams): void
engine.filters.remove(layerId: string, effectId: string): void
engine.filters.get(layerId: string): LiveFilterDef[]
```

### Filter Types

| `LiveFilterType` | Params |
|:----------------|:-------|
| `"color"` | `brightness?, contrast?, saturation?, hue?` |
| `"blur"` | `strength: number` |
| `"noise"` | `noise: number` |
| `"adjustment"` | `alpha: number` |

### Sugar API

```typescript
engine.setBrightness(layerId: string, value: number): void
engine.setContrast(layerId: string, value: number): void
engine.setSaturation(layerId: string, value: number): void
engine.setHue(layerId: string, value: number): void
engine.setBlur(layerId: string, strength: number): void
engine.setOpacity(layerId: string, value: number): void
```

---

## CPU / WASM Filters

```typescript
engine.registerFilter(name: string, fn: WasmFilterFn): void
await engine.applyWasmFilter(filterName: string): Promise<void>
await engine.syncPixels(buffer: PixelBuffer): Promise<void>  // No undo recorded
```

---

## Presets

```typescript
await engine.presets.applyFilter(name: string): Promise<void>
await engine.presets.applyCrop(name: string): Promise<void>
engine.presets.registerFilter(name: string, fn: WasmFilterFn): void
engine.presets.registerCrop(name: string, fn: CropPresetFn): void
engine.presets.listFilters(): string[]
engine.presets.listCrops(): string[]
```

### `CropPresetFn`

```typescript
type CropPresetFn = (width: number, height: number) => Rect;
```

---

## Crop & Resize

```typescript
await engine.applyCrop(rect: Rect): Promise<void>
await engine.resize(width: number, height: number): Promise<void>
```

### `Rect`

```typescript
interface Rect { x: number; y: number; width: number; height: number; }
```

---

## Pixel Extraction

```typescript
await engine.cloneLayer(): Promise<PixelBuffer>
await engine.extractLayerImageData(): Promise<ImageData | null>
await engine.getHistogram(): Promise<HistogramData>
```

### `PixelBuffer`

```typescript
interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}
```

### `HistogramData`

```typescript
interface HistogramData {
  r: Uint32Array;    // 256 bins
  g: Uint32Array;
  b: Uint32Array;
  lum: Uint32Array;  // 0.299R + 0.587G + 0.114B
}
```

---

## Coordinate Mapping

```typescript
engine.canvasToImage(x: number, y: number): Point | null
engine.getTextureRect(canvasRect: Rect): Rect | null
```

### `Point`

```typescript
interface Point { x: number; y: number; }
```

---

## Undo / Redo

```typescript
await engine.undo(): Promise<boolean>
await engine.redo(): Promise<boolean>
engine.canUndo(): boolean
engine.canRedo(): boolean
engine.commandHistory: readonly Command[]
await engine.execute(command: Command): Promise<void>
```

---

## Export

```typescript
await engine.saveImage(options?: ExportOptions): Promise<Blob | string>
await engine.exportImage(options?: ExportOptions): Promise<ExportResult>
await engine.exportOverlays(options?: ExportOptions): Promise<ExportResult>
```

### `ExportOptions`

```typescript
interface ExportOptions {
  format?: "blob" | "base64";
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  quality?: number;                    // 0.0–1.0 (lossy formats)
  returnType?: "blob" | "dataURL";
  dimensions?: { width: number; height: number };
}
```

### `ExportResult`

```typescript
interface ExportResult {
  format: "base64" | "blob";
  data?: string | null;
  blob?: Blob;
  mimeType: string;
}
```

---

## Interactivity

```typescript
engine.setInteractive(enabled: boolean): void
```

---

## Plugins

```typescript
engine.use(plugin: EzRenPlugin): this
```

### `EzRenPlugin`

```typescript
interface EzRenPlugin {
  name: string;
  install(api: EzRenPluginAPI): void;
}

interface EzRenPluginAPI {
  readonly app: Application;
  getLayers(): ReadonlyMap<string, EzLayer>;
  getSelectedLayerId(): string | null;
  registerFilter(name: string, fn: WasmFilterFn): void;
}
```

---

## Static Utilities

```typescript
EzRen.utils.clamp(value: number): number       // Clamps to 0–255 and rounds
EzRen.utils.hexToRgb(hex: string): { r, g, b } // Parses hex color string
```
