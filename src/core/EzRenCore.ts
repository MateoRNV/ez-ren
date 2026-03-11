/**
 * EzRenCore — Headless image-editing engine.
 *
 * Contains: RenderSystem, LayerManager, CommandManager, FilterManager, PluginManager.
 * Does NOT contain: InteractionManager, TransformerGizmo, or any pointer-event logic.
 *
 * Can be used standalone (headless export/processing) or combined with
 * EzRenInteraction to add interactive editing capabilities.
 */

import {
  Assets,
  Sprite,
  Text,
  Texture,
  BufferImageSource,
  Container,
  type DestroyOptions,
} from "pixi.js";

import type {
  EzRenOptions,
  EzLayer,
  EzRenPlugin,
  EzRenPluginAPI,
  Command,
  TransformState,
  PixelBuffer,
  WasmFilterFn,
  ExportOptions,
  ExportResult,
  Point,
  Rect,
  TextLayerStyle,
  TextLayerInfo,
  HistogramData,
} from "../types.js";

import { RenderSystem } from "./rendering/RenderSystem.js";
import { LayerManager, type EzLayerInternal } from "./managers/LayerManager.js";
import { CommandManager } from "./managers/CommandManager.js";
import { PluginManager } from "./managers/PluginManager.js";
import { FilterManager } from "./managers/FilterManager.js";
import { PresetManager } from "./managers/PresetManager.js";
import type { LiveFilterType, LiveFilterParams, LiveFilterDef } from "../types.js";
import { EventEmitter } from "./EventEmitter.js";

// ─── Core event catalogue ────────────────────────────────────────────────────

export interface EzRenCoreEvents {
  /** Fires whenever the active selection changes. Payload is the new layerId or null. */
  "selection:change": string | null;
  /** Fires after every execute / undo / redo. */
  "history:change": { canUndo: boolean; canRedo: boolean };
  /** Fires when a layer's visual state changes (transform, filter, pixels). */
  "layer:update": string;
  /** Fires when a new layer is added. */
  "layer:add": string;
  /** Fires when a layer is removed. */
  "layer:remove": string;
}

// ─────────────────────────────────────────────────────────────────────────────

export class EzRenCore extends EventEmitter<EzRenCoreEvents> {
  // ── Static utils ──────────────────────────────────────────────────────────
  static readonly utils = {
    clamp(v: number): number {
      return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    },
    hexToRgb(hex: string): { r: number; g: number; b: number } {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
        : { r: 0, g: 0, b: 0 };
    },
  };

  // ── Internal subsystems ───────────────────────────────────────────────────
  /** @internal — exposed for EzRenInteraction to access directly */
  readonly renderSys: RenderSystem;
  /** @internal */
  readonly layers: LayerManager;
  /** @internal */
  readonly commands: CommandManager;
  /** @internal */
  readonly filterManager: FilterManager;
  /** Registry of named filter and crop presets. */
  readonly presets: PresetManager;

  private plugins: PluginManager;
  private photonModule: typeof import("@silvia-odwyer/photon") | null = null;
  private readonly filterRegistry = new Map<string, WasmFilterFn>();

  // ── Selection (with event emission) ──────────────────────────────────────
  get selectedLayerId(): string | null {
    return this.layers.selectedLayerId;
  }
  set selectedLayerId(id: string | null) {
    const previous = this.layers.selectedLayerId;
    this.layers.selectedLayerId = id;
    if (previous !== id) {
      this.emit("selection:change", id);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  constructor(options: EzRenOptions) {
    super();
    const defaultRes = typeof window !== "undefined" ? window.devicePixelRatio : 1;
    const reqOptions: Required<EzRenOptions> = {
      canvas: options.canvas,
      backgroundColor: options.backgroundColor ?? 0x1a1a2e,
      resolution: options.resolution ?? (defaultRes || 1),
      antialias: options.antialias ?? true,
      maxHistory: options.maxHistory ?? 50,
    };

    this.renderSys = new RenderSystem(reqOptions);
    this.layers = new LayerManager(this.renderSys);
    this.commands = new CommandManager(reqOptions.maxHistory);
    this.filterManager = new FilterManager(this.layers, this.commands);
    this.presets = new PresetManager();

    // Wire history events from CommandManager → core emitter
    this.commands.onHistoryChange = (state) => {
      this.emit("history:change", state);
    };

    const self = this;
    const api: EzRenPluginAPI = {
      get app() { return self.renderSys.app; },
      getLayers: () => self.getLayers(),
      getSelectedLayerId: () => self.selectedLayerId,
      registerFilter: (name, fn) => self.registerFilter(name, fn),
    };
    this.plugins = new PluginManager(api);
  }

  // ── 0. Lifecycle ─────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.renderSys.init();

    try {
      this.photonModule = await import("@silvia-odwyer/photon");
    } catch (err) {
      console.warn("[EzRenCore] Failed to load Photon WASM module.", err);
    }

    this.renderSys.resize((width, height) => {
      for (const [id, layer] of this.layers.getAll()) {
        if (layer.type === "image") this.layers.centerLayer(id);
      }
    });
  }

  destroy(): void {
    this.layers.clearLayers();
    this.filterManager.clearAll();
    this.commands.clear();
    this.renderSys.destroy();
    this.removeAllListeners();
  }

  // ── 1. Filter facade ─────────────────────────────────────────────────────

  public readonly filters = {
    add: (layerId: string, type: LiveFilterType, params?: LiveFilterParams): string => {
      this._assertInitialised();
      const id = this.filterManager.addEffect(layerId, type, params);
      this.emit("layer:update", layerId);
      return id;
    },
    remove: (layerId: string, effectId: string): void => {
      this._assertInitialised();
      this.filterManager.removeEffect(layerId, effectId);
      this.emit("layer:update", layerId);
    },
    update: (layerId: string, effectId: string, params: LiveFilterParams): void => {
      this._assertInitialised();
      this.filterManager.updateEffect(layerId, effectId, params);
      this.emit("layer:update", layerId);
    },
    get: (layerId: string): LiveFilterDef[] => {
      this._assertInitialised();
      return this.filterManager.getEffects(layerId);
    },
  };

  // ── 2. Sugar API ─────────────────────────────────────────────────────────

  /**
   * Convenience: set the brightness on a layer's 'color' filter.
   * Creates the filter if it doesn't exist yet.
   */
  setBrightness(layerId: string, value: number): void {
    this._upsertColorFilter(layerId, { brightness: value });
  }

  /**
   * Convenience: set the contrast on a layer's 'color' filter.
   * Creates the filter if it doesn't exist yet.
   */
  setContrast(layerId: string, value: number): void {
    this._upsertColorFilter(layerId, { contrast: value });
  }

  /**
   * Convenience: set the saturation on a layer's 'color' filter.
   */
  setSaturation(layerId: string, value: number): void {
    this._upsertColorFilter(layerId, { saturation: value });
  }

  /**
   * Convenience: set the hue on a layer's 'color' filter.
   */
  setHue(layerId: string, value: number): void {
    this._upsertColorFilter(layerId, { hue: value });
  }

  /**
   * Convenience: set the blur strength on a layer.
   * Creates or updates the 'blur' filter.
   */
  setBlur(layerId: string, strength: number): void {
    const existing = this.filterManager.getEffects(layerId).find(f => f.type === "blur");
    if (existing) {
      this.filters.update(layerId, existing.id, { strength });
    } else {
      this.filters.add(layerId, "blur", { strength });
    }
  }

  /**
   * Convenience: set the layer alpha using the 'adjustment' filter.
   * Creates or updates it.
   */
  setOpacity(layerId: string, value: number): void {
    const existing = this.filterManager.getEffects(layerId).find(f => f.type === "adjustment");
    if (existing) {
      this.filters.update(layerId, existing.id, { alpha: value });
    } else {
      this.filters.add(layerId, "adjustment", { alpha: value });
    }
  }

  private _upsertColorFilter(layerId: string, params: LiveFilterParams): void {
    const existing = this.filterManager.getEffects(layerId).find(f => f.type === "color");
    if (existing) {
      this.filters.update(layerId, existing.id, params);
    } else {
      this.filters.add(layerId, "color", params);
    }
  }

  // ── 3. Image Layer ────────────────────────────────────────────────────────

  async addImageLayer(url: string, id: string = crypto.randomUUID()): Promise<string> {
    this._assertInitialised();

    let texture: Texture;
    if (
      typeof window !== "undefined" &&
      window.Image &&
      (url.startsWith("blob:") || url.startsWith("data:"))
    ) {
      texture = await new Promise<Texture>((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => { try { resolve(Texture.from(img)); } catch (e) { reject(e); } };
        img.onerror = reject;
        img.src = url;
      });
    } else {
      texture = await Assets.load<Texture>(url);
    }

    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 0.5);

    const zIndex = this.layers.imgZIndex++;
    sprite.zIndex = zIndex;

    const transform: TransformState = {
      rotation: 0, scaleX: 1, scaleY: 1, x: 0, y: 0, flipX: false, flipY: false,
    };

    const layerInternal: EzLayerInternal = {
      id,
      type: "image",
      visible: true,
      locked: false,
      zIndex,
      displayObject: sprite,
      transform,
      fitScale: 1,
      url,
    };

    this.layers.addLayer(layerInternal);

    if (!this.selectedLayerId) {
      this.selectedLayerId = id;
    }

    this.layers.centerLayer(id);
    this.emit("layer:add", id);
    return id;
  }

  clearLayers(): void {
    this._assertInitialised();
    this.selectedLayerId = null;
    this.layers.clearLayers();
    this.filterManager.clearAll();
    this.commands.clear();
  }

  selectLayer(id: string): void {
    if (!this.layers.getLayer(id)) {
      throw new Error(`[EzRenCore] Layer with id "${id}" does not exist.`);
    }
    this.selectedLayerId = id;
  }

  moveLayer(id: string, x: number, y: number): void {
    const layer = this.layers.getLayer(id);
    if (!layer || layer.type !== "image") return;
    const sprite = layer.displayObject as Sprite;
    sprite.x = x;
    sprite.y = y;
    layer.transform!.x = x;
    layer.transform!.y = y;
    this.emit("layer:update", id);
  }

  bringToFront(id: string): void {
    const layer = this.layers.getLayer(id);
    if (!layer) return;
    let maxZ = 0;
    for (const l of this.layers.getAll().values()) {
      if (l.zIndex > maxZ) maxZ = l.zIndex;
    }
    this.layers.reorder(id, maxZ + 1);
    this.emit("layer:update", id);
  }

  sendToBack(id: string): void {
    const layer = this.layers.getLayer(id);
    if (!layer) return;
    let minZ = Infinity;
    for (const l of this.layers.getAll().values()) {
      if (l.zIndex < minZ) minZ = l.zIndex;
    }
    this.layers.reorder(id, minZ - 1);
    this.emit("layer:update", id);
  }

  reorderLayer(id: string, newZIndex: number): void {
    this.layers.reorder(id, newZIndex);
    this.emit("layer:update", id);
  }

  lockLayer(id: string): void {
    const layer = this.layers.getLayer(id);
    if (layer) layer.locked = true;
  }

  unlockLayer(id: string): void {
    const layer = this.layers.getLayer(id);
    if (layer) layer.locked = false;
  }

  setLayerVisible(id: string, visible: boolean): void {
    const layer = this.layers.getLayer(id);
    if (!layer) return;
    layer.visible = visible;
    layer.displayObject.visible = visible;
    this.emit("layer:update", id);
  }

  removeLayer(id: string): void {
    if (this.selectedLayerId === id) {
      this.selectedLayerId = null;
    }
    this.layers.removeLayer(id);
    this.emit("layer:remove", id);
  }

  getLayer(id: string): EzLayer | null {
    const layer = this.layers.getLayer(id);
    return layer ? this.layers.toPublicLayer(layer) : null;
  }

  getLayers(): ReadonlyMap<string, EzLayer> {
    const result = new Map<string, EzLayer>();
    for (const [id, layer] of this.layers.getAll()) {
      result.set(id, this.layers.toPublicLayer(layer));
    }
    return result;
  }

  // ── 4. Transform Proxy ────────────────────────────────────────────────────

  rotate(degrees: number): void {
    this._assertImageLayerSelected("rotate");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const transform = layer.transform!;
    const before = { ...transform };
    const after: TransformState = { ...before, rotation: (before.rotation + degrees) % 360 };

    this.commands.execute({
      id: crypto.randomUUID(),
      type: "transform",
      description: `rotate ${degrees}°`,
      execute: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, after); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
      undo: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, before); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
    });
  }

  setRotation(degrees: number): void {
    this._assertImageLayerSelected("setRotation");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const transform = layer.transform!;
    const before = { ...transform };
    const after: TransformState = { ...before, rotation: degrees % 360 };

    this.commands.execute({
      id: crypto.randomUUID(),
      type: "transform",
      description: `setRotation ${degrees}°`,
      execute: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, after); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
      undo: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, before); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
    });
  }

  flip(dir: "h" | "v"): void {
    this._assertImageLayerSelected("flip");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const transform = layer.transform!;
    const before = { ...transform };
    const after = { ...transform };
    if (dir === "h") after.flipX = !after.flipX;
    else after.flipY = !after.flipY;

    this.commands.execute({
      id: crypto.randomUUID(),
      type: "transform",
      description: `flip ${dir}`,
      execute: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, after); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
      undo: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, before); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
    });
  }

  resetTransform(): void {
    this._assertImageLayerSelected("resetTransform");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const transform = layer.transform!;
    const before = { ...transform };
    const after: TransformState = { ...transform, rotation: 0, flipX: false, flipY: false };

    this.commands.execute({
      id: crypto.randomUUID(),
      type: "transform",
      description: "resetTransform",
      execute: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, after); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
      undo: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, before); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
    });
  }

  scale(scaleX: number, scaleY?: number): void {
    this._assertImageLayerSelected("scale");
    if (scaleX <= 0 || (scaleY !== undefined && scaleY <= 0)) {
      throw new RangeError("[EzRenCore] scale factor must be > 0");
    }

    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const transform = layer.transform!;
    const before = { ...transform };
    const after: TransformState = { ...before, scaleX, scaleY: scaleY ?? scaleX };

    this.commands.execute({
      id: crypto.randomUUID(),
      type: "transform",
      description: `scale ${scaleX}x${scaleY ?? scaleX}`,
      execute: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, after); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
      undo: () => {
        const l = this.layers.getLayer(id);
        if (l?.transform) { Object.assign(l.transform, before); this.layers.syncLayerTransform(id); }
        this.emit("layer:update", id);
      },
    });
  }

  get transform(): Readonly<TransformState> | null {
    if (!this.selectedLayerId) return null;
    const layer = this.layers.getLayer(this.selectedLayerId);
    if (!layer || layer.type !== "image" || !layer.transform) return null;
    return { ...layer.transform };
  }

  // ── 5. Coordinate Mappers ─────────────────────────────────────────────────

  canvasToImage(x: number, y: number): Point | null {
    this._assertImageLayerSelected("canvasToImage");
    const sprite = (this.layers.getLayer(this.selectedLayerId!)!).displayObject as Sprite;
    const texW = sprite.texture.width;
    const texH = sprite.texture.height;

    const local = sprite.toLocal({ x, y });
    let px = local.x + texW * 0.5;
    let py = local.y + texH * 0.5;

    const margin = Math.max(texW, texH) * 0.5;
    if (px < -margin || px > texW + margin || py < -margin || py > texH + margin) {
      return null;
    }

    px = Math.max(0, Math.min(px, texW));
    py = Math.max(0, Math.min(py, texH));
    return { x: px, y: py };
  }

  getTextureRect(canvasRect: Rect): Rect | null {
    const pts = [
      this.canvasToImage(canvasRect.x, canvasRect.y),
      this.canvasToImage(canvasRect.x + canvasRect.width, canvasRect.y),
      this.canvasToImage(canvasRect.x, canvasRect.y + canvasRect.height),
      this.canvasToImage(canvasRect.x + canvasRect.width, canvasRect.y + canvasRect.height),
    ];

    const validPts = pts.filter((p): p is Point => p !== null);
    if (validPts.length === 0) return null;

    const xs = validPts.map(p => p.x);
    const ys = validPts.map(p => p.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  // ── 6. WASM / Photon Filter Hook ──────────────────────────────────────────

  registerFilter(name: string, fn: WasmFilterFn): void {
    this.filterRegistry.set(name, fn);
  }

  async applyWasmFilter(filterName: string, filterFn?: WasmFilterFn): Promise<void> {
    this._assertImageLayerSelected("applyWasmFilter");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const beforeRaw = await this._extractPixels();
    const beforeSnapshot: PixelBuffer = {
      data: new Uint8ClampedArray(beforeRaw.data),
      width: beforeRaw.width,
      height: beforeRaw.height,
    };

    const fn = filterFn ?? this.filterRegistry.get(filterName);
    let processedBuffer: PixelBuffer = beforeRaw;

    if (fn) {
      // NOTE: `processedBuffer` may be a reference to the same `beforeRaw` object
      // (mutation in-place). This is why the `beforeSnapshot` must be created
      // strictly *before* executing the filter function.
      processedBuffer = await fn(beforeRaw);
    } else if (this.photonModule) {
      let photonImage: any;
      try {
        const rawArray = new Uint8Array(beforeRaw.data.buffer, beforeRaw.data.byteOffset, beforeRaw.data.byteLength);
        photonImage = new this.photonModule.PhotonImage(rawArray, beforeRaw.width, beforeRaw.height);
        const photon = this.photonModule as any;
        if (typeof photon[filterName] === "function") {
          photon[filterName](photonImage);
        } else {
          console.warn(`[EzRenCore] Unknown Photon filter: "${filterName}"`);
        }
        processedBuffer = {
          data: photonImage.get_raw_pixels(),
          width: photonImage.get_width(),
          height: photonImage.get_height(),
        };
      } finally {
        if (photonImage) photonImage.free();
      }
    } else {
      console.warn(`[EzRenCore] No filter "${filterName}" and Photon is not loaded.`);
    }

    const afterSnapshot: PixelBuffer = {
      data: new Uint8ClampedArray(processedBuffer.data),
      width: processedBuffer.width,
      height: processedBuffer.height,
    };

    await this.commands.execute({
      id: crypto.randomUUID(),
      type: "filter",
      description: filterName,
      execute: async () => {
        if (this.layers.getLayer(id)) {
          await this._uploadPixelsToLayer(id, afterSnapshot);
          this.emit("layer:update", id);
        }
      },
      undo: async () => {
        if (this.layers.getLayer(id)) {
          await this._uploadPixelsToLayer(id, beforeSnapshot);
          this.emit("layer:update", id);
        }
      },
    });
  }

  async syncPixels(buffer: PixelBuffer): Promise<void> {
    this._assertImageLayerSelected("syncPixels");
    await this._uploadPixelsToLayer(this.selectedLayerId!, buffer);
    this.emit("layer:update", this.selectedLayerId!);
  }

  // ── 7. Text Layer ─────────────────────────────────────────────────────────

  addTextLayer(text: string, style: TextLayerStyle = {}): string {
    this._assertInitialised();
    const id = crypto.randomUUID();

    const pixiText = new Text(text, {
      fill: style.fill ?? "#ffffff",
      fontSize: style.fontSize ?? 64,
      fontFamily: style.fontFamily ?? "Arial",
      fontWeight: (style.fontWeight as any) ?? "normal",
      fontStyle: (style.fontStyle as any) ?? "normal",
    });

    pixiText.anchor.set(0.5, 0.5);
    pixiText.x = this.renderSys.app.screen.width / 2;
    pixiText.y = this.renderSys.app.screen.height / 2;

    const zIndex = this.layers.txtZIndex++;
    pixiText.zIndex = zIndex;

    this.layers.addLayer({
      id,
      type: "text",
      visible: true,
      locked: false,
      zIndex,
      displayObject: pixiText,
    });

    this.emit("layer:add", id);
    return id;
  }

  removeTextLayer(id: string): void {
    const layer = this.layers.getLayer(id);
    if (layer?.type === "text") this.removeLayer(id);
  }

  updateTextLayer(id: string, text?: string, style: TextLayerStyle = {}): void {
    const layer = this.layers.getLayer(id);
    if (!layer || layer.type !== "text") return;
    const textObj = layer.displayObject as Text;

    if (text !== undefined) textObj.text = text;
    if (style.fill !== undefined) textObj.style.fill = style.fill;
    if (style.fontSize !== undefined) textObj.style.fontSize = style.fontSize;
    if (style.fontFamily !== undefined) textObj.style.fontFamily = style.fontFamily;
    if (style.fontWeight !== undefined) textObj.style.fontWeight = style.fontWeight as any;
    if (style.fontStyle !== undefined) textObj.style.fontStyle = style.fontStyle as any;
    this.emit("layer:update", id);
  }

  getAllTextLayerIds(): string[] {
    return Array.from(this.layers.getAll().entries())
      .filter(([, l]) => l.type === "text")
      .map(([id]) => id);
  }

  getTextLayerInfo(id: string): TextLayerInfo | null {
    const layer = this.layers.getLayer(id);
    if (!layer || layer.type !== "text") return null;
    const textObj = layer.displayObject as Text;
    return {
      id,
      text: textObj.text,
      x: textObj.x,
      y: textObj.y,
      style: {
        fill: String(textObj.style.fill),
        fontSize: Number(textObj.style.fontSize),
        fontFamily: textObj.style.fontFamily,
        fontWeight: textObj.style.fontWeight as string | number,
        fontStyle: textObj.style.fontStyle as string,
      },
    };
  }

  // ── 8. Resize ─────────────────────────────────────────────────────────────

  async resize(width: number, height: number): Promise<void> {
    this._assertImageLayerSelected("resize");
    if (width < 1 || height < 1) throw new RangeError("[EzRenCore] resize dimensions must be >= 1");

    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const w = Math.round(width);
    const h = Math.round(height);

    const beforeRaw = await this._extractPixels();
    const beforeSnapshot: PixelBuffer = {
      data: new Uint8Array(beforeRaw.data),
      width: beforeRaw.width,
      height: beforeRaw.height,
    };
    const beforeScale = { scaleX: layer.transform!.scaleX, scaleY: layer.transform!.scaleY };

    const src = document.createElement("canvas");
    src.width = beforeRaw.width;
    src.height = beforeRaw.height;
    const sctx = src.getContext("2d")!;
    sctx.putImageData(
      new ImageData(
        new Uint8ClampedArray(beforeRaw.data.buffer as ArrayBuffer, beforeRaw.data.byteOffset, beforeRaw.data.byteLength),
        beforeRaw.width,
        beforeRaw.height,
      ),
      0,
      0,
    );

    const dst = document.createElement("canvas");
    dst.width = w;
    dst.height = h;
    const dctx = dst.getContext("2d")!;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = "high";
    dctx.drawImage(src, 0, 0, w, h);
    const resized = dctx.getImageData(0, 0, w, h);

    const afterBuffer: PixelBuffer = { data: new Uint8Array(resized.data.buffer), width: w, height: h };
    const afterSnapshot: PixelBuffer = { data: new Uint8Array(afterBuffer.data), width: w, height: h };

    await this.commands.execute({
      id: crypto.randomUUID(),
      type: "resize",
      description: `resize to ${w}×${h}`,
      execute: async () => {
        if (!this.layers.getLayer(id)) return;
        await this._uploadPixelsToLayer(id, afterSnapshot);
        const l = this.layers.getLayer(id)!;
        l.transform!.scaleX = 1;
        l.transform!.scaleY = 1;
        this.layers.centerLayer(id);
        this.emit("layer:update", id);
      },
      undo: async () => {
        if (!this.layers.getLayer(id)) return;
        await this._uploadPixelsToLayer(id, beforeSnapshot);
        const l = this.layers.getLayer(id)!;
        l.transform!.scaleX = beforeScale.scaleX;
        l.transform!.scaleY = beforeScale.scaleY;
        this.layers.centerLayer(id);
        this.emit("layer:update", id);
      },
    });
  }

  // ── 9. Histogram ──────────────────────────────────────────────────────────

  async getHistogram(): Promise<HistogramData> {
    this._assertImageLayerSelected("getHistogram");
    const pixels = await this._extractPixels();
    const data = pixels.data;

    const r = new Uint32Array(256);
    const g = new Uint32Array(256);
    const b = new Uint32Array(256);
    const lum = new Uint32Array(256);

    for (let i = 0; i < data.length; i += 4) {
      r[data[i]]++;
      g[data[i + 1]]++;
      b[data[i + 2]]++;
      const l = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      lum[l]++;
    }

    return { r, g, b, lum };
  }

  // ── 10. Clone ─────────────────────────────────────────────────────────────

  async cloneLayer(): Promise<PixelBuffer> {
    this._assertImageLayerSelected("cloneLayer");
    const pixels = await this._extractPixels();
    return {
      data: new Uint8Array(pixels.data),
      width: pixels.width,
      height: pixels.height,
    };
  }

  // ── 11. Crop ──────────────────────────────────────────────────────────────

  async applyCrop(rect: Rect): Promise<void> {
    this._assertImageLayerSelected("applyCrop");
    const id = this.selectedLayerId!;
    const layer = this.layers.getLayer(id)!;
    if (layer.locked) return;

    const beforeRaw = await this._extractPixels();
    const beforeSnapshot: PixelBuffer = {
      data: new Uint8Array(beforeRaw.data),
      width: beforeRaw.width,
      height: beforeRaw.height,
    };

    const srcW = beforeRaw.width;
    const srcH = beforeRaw.height;

    const safeX = Math.max(0, Math.min(Math.round(rect.x), srcW - 1));
    const safeY = Math.max(0, Math.min(Math.round(rect.y), srcH - 1));
    const safeW = Math.max(1, Math.min(Math.round(rect.width), srcW - safeX));
    const safeH = Math.max(1, Math.min(Math.round(rect.height), srcH - safeY));

    const croppedData = new Uint8Array(safeW * safeH * 4);
    for (let row = 0; row < safeH; row++) {
      const srcOffset = ((safeY + row) * srcW + safeX) * 4;
      const dstOffset = row * safeW * 4;
      croppedData.set(
        new Uint8Array(beforeRaw.data.buffer, beforeRaw.data.byteOffset + srcOffset, safeW * 4),
        dstOffset,
      );
    }

    const afterSnapshot: PixelBuffer = { data: new Uint8Array(croppedData), width: safeW, height: safeH };

    await this.commands.execute({
      id: crypto.randomUUID(),
      type: "crop",
      description: `crop ${safeW}×${safeH}`,
      execute: async () => {
        if (this.layers.getLayer(id)) {
          await this._uploadPixelsToLayer(id, afterSnapshot);
          this.layers.centerLayer(id);
          this.emit("layer:update", id);
        }
      },
      undo: async () => {
        if (this.layers.getLayer(id)) {
          await this._uploadPixelsToLayer(id, beforeSnapshot);
          this.layers.centerLayer(id);
          this.emit("layer:update", id);
        }
      },
    });
  }

  // ── 11b. Preset application ───────────────────────────────────────────────

  async applyPresetFilter(name: string): Promise<void> {
    const fn = this.presets.getFilter(name);
    if (!fn) {
      throw new Error(`EzRen: Filter preset "${name}" not found.`);
    }

    // Auto-replace: if the last command was a preset filter, undo it first
    // so presets replace rather than stack destructively on the previous result
    const history = this.commands.history;
    if (history.length > 0 && history[history.length - 1].type === "filter") {
      await this.commands.undo();
    }

    await this.applyWasmFilter(name, fn);
  }

  async applyPresetCrop(name: string): Promise<void> {
    if (!this.selectedLayerId) {
      throw new Error('EzRen: No layer selected.');
    }

    const id = this.selectedLayerId;
    const layer = this.layers.getLayer(id);
    if (!layer) {
      throw new Error('EzRen: No layer selected.');
    }
    if (layer.type !== "image") {
      throw new Error('EzRen: Selected layer is not a valid image.');
    }

    const sprite = layer.displayObject as Sprite;
    const width = sprite.texture.orig.width;
    const height = sprite.texture.orig.height;

    const rect = this.presets.getCrop(name, width, height);
    if (!rect) {
      throw new Error(`EzRen: Crop preset "${name}" not found.`);
    }

    await this.applyCrop(rect);
  }

  async extractLayerImageData(): Promise<ImageData | null> {
    this._assertInitialised();
    if (!this.selectedLayerId) return null;
    const layer = this.layers.getLayer(this.selectedLayerId);
    if (!layer || layer.type !== "image") return null;

    const sprite = layer.displayObject as Sprite;
    const transform = layer.transform;

    if (transform && (transform.rotation !== 0 || transform.flipX || transform.flipY)) {
      const tempContainer = new Container();
      const tempSprite = new Sprite(sprite.texture);
      tempSprite.anchor.set(0.5, 0.5);
      tempSprite.rotation = (transform.rotation * Math.PI) / 180;
      tempSprite.scale.set(
        (transform.flipX ? -1 : 1) * transform.scaleX,
        (transform.flipY ? -1 : 1) * transform.scaleY,
      );

      tempContainer.addChild(tempSprite);
      const bounds = tempContainer.getLocalBounds();
      tempSprite.x = -bounds.minX;
      tempSprite.y = -bounds.minY;

      const output = this.renderSys.extractPixels(tempContainer);
      tempContainer.destroy({ children: true, texture: false, textureSource: false } as any);
      return new ImageData(
        new Uint8ClampedArray(output.data.buffer as ArrayBuffer, output.data.byteOffset, output.data.byteLength) as any,
        output.width,
        output.height,
      );
    } else {
      const output = this.renderSys.extractPixels(sprite.texture);
      return new ImageData(
        new Uint8ClampedArray(output.data.buffer as ArrayBuffer, output.data.byteOffset, output.data.byteLength) as any,
        output.width,
        output.height,
      );
    }
  }

  // ── 12. Export ────────────────────────────────────────────────────────────

  async saveImage(options: ExportOptions = {}): Promise<Blob | string> {
    this._assertInitialised();
    this.renderSys.app.render();
    return this.renderSys.exportComposition(options);
  }

  async exportImage(options: ExportOptions = {}): Promise<ExportResult> {
    this._assertInitialised();
    const format = options.format ?? "base64";
    const mimeType = options.mimeType ?? "image/png";
    const quality = options.quality ?? 0.95;
    const pixiFormat = mimeType.split("/")[1] as "png" | "jpg" | "webp";
    this.renderSys.app.render();

    if (format === "blob") {
      const canvas = this.renderSys.app.renderer.extract.canvas({ target: this.renderSys.mainContainer });
      const blob = await new Promise<Blob | null>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob(resolve, mimeType, quality),
      );
      if (!blob) throw new Error("[EzRenCore] Export failed: could not create blob.");
      return { format: "blob", blob, mimeType };
    } else {
      const data = await this.renderSys.app.renderer.extract.base64({
        target: this.renderSys.mainContainer,
        format: pixiFormat as any,
        quality,
      });
      return { format, data, mimeType };
    }
  }

  async exportOverlays(options: ExportOptions = {}): Promise<ExportResult> {
    this._assertInitialised();
    const format = options.format ?? "base64";
    const mimeType = options.mimeType ?? "image/png";
    const quality = options.quality ?? 0.95;
    const layersValues = Array.from(this.layers.getAll().values());
    const textLayers = layersValues.filter(l => l.type === "text");
    if (textLayers.length === 0) return { format, data: null, mimeType };

    const imageLayers = layersValues.filter(l => l.type === "image");
    for (const l of imageLayers) l.displayObject.visible = false;

    this.renderSys.app.render();

    const pixiFormat = mimeType.split("/")[1] as "png" | "jpg" | "webp";
    let result: ExportResult;

    if (format === "blob") {
      const canvas = this.renderSys.app.renderer.extract.canvas({ target: this.renderSys.sceneContainer });
      const blob = await new Promise<Blob | null>((resolve) =>
        (canvas as HTMLCanvasElement).toBlob(resolve, mimeType, quality),
      );
      if (!blob) throw new Error("[EzRenCore] Export overlays failed: could not create blob.");
      result = { format: "blob", blob, mimeType };
    } else {
      const data = await this.renderSys.app.renderer.extract.base64({
        target: this.renderSys.sceneContainer,
        format: pixiFormat as any,
        quality,
      });
      result = { format, data, mimeType };
    }

    for (const l of imageLayers) l.displayObject.visible = l.visible;

    return result;
  }

  // ── 13. Command System ────────────────────────────────────────────────────

  /** Execute an arbitrary command and record it in history. */
  execute(command: Command): Promise<void> {
    return this.commands.execute(command);
  }

  async undo(): Promise<boolean> {
    return this.commands.undo();
  }

  async redo(): Promise<boolean> {
    return this.commands.redo();
  }

  canUndo(): boolean {
    return this.commands.canUndo();
  }

  canRedo(): boolean {
    return this.commands.canRedo();
  }

  get commandHistory(): readonly Command[] {
    return this.commands.history;
  }

  // ── 14. Plugin System ─────────────────────────────────────────────────────

  use(plugin: EzRenPlugin): this {
    this._assertInitialised();
    this.plugins.use(plugin);
    return this;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async _extractPixels(): Promise<PixelBuffer> {
    const layer = this.layers.getLayer(this.selectedLayerId!)!;
    const texture = (layer.displayObject as Sprite).texture;
    return this.renderSys.extractPixels(texture, 1);
  }

  private async _uploadPixelsToLayer(id: string, buffer: PixelBuffer): Promise<void> {
    const { data, width, height } = buffer;
    const rawArray = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const layer = this.layers.getLayer(id);
    if (!layer || layer.type !== "image") return;

    const sprite = layer.displayObject as Sprite;
    const originalResolution = sprite.texture.source.resolution || 1;

    const bufferSource = new BufferImageSource({
      resource: rawArray,
      width,
      height,
      format: "rgba8unorm",
      alphaMode: "no-premultiply-alpha",
      resolution: originalResolution,
    });

    const newTexture = new Texture({ source: bufferSource });

    if (layer.url) {
      if (!layer.url.startsWith("blob:") && !layer.url.startsWith("data:")) {
        Assets.unload(layer.url).catch(e => console.warn(e));
      }
      layer.url = undefined;
    } else {
      sprite.texture.destroy(true);
    }

    sprite.texture = newTexture;
    this.layers.syncLayerTransform(id);
  }

  _assertInitialised(): void {
    if (!this.renderSys.isReady) {
      throw new Error("[EzRenCore] Engine not initialised. Await core.init().");
    }
  }

  private _assertImageLayerSelected(method: string): void {
    this._assertInitialised();
    if (!this.selectedLayerId) {
      throw new Error(`[EzRenCore] No layer selected. Call core.selectLayer(id) before core.${method}().`);
    }
    const layer = this.layers.getLayer(this.selectedLayerId);
    if (!layer) {
      throw new Error(`[EzRenCore] Selected layer "${this.selectedLayerId}" no longer exists.`);
    }
    if (layer.type !== "image") {
      throw new Error(`[EzRenCore] core.${method}() requires an image layer to be selected.`);
    }
  }
}
