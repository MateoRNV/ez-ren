/**
 * EzRen — Full-featured facade that composes EzRenCore + EzRenInteraction.
 *
 * This is the "batteries-included" class for browser environments.
 * For headless / server-side use, import EzRenCore directly instead.
 *
 * @example
 *   import { EzRen } from 'ez-ren';
 *   const engine = new EzRen({ canvas: document.getElementById('editor') });
 *   await engine.init();
 *   const id = await engine.addImageLayer('photo.jpg');
 */

import type {
  EzRenOptions,
  EzLayer,
  EzRenPlugin,
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
} from "./types.js";

import { EzRenCore, type EzRenCoreEvents } from "./core/EzRenCore.js";
import { EzRenInteraction } from "./runtime/EzRenInteraction.js";
import type { LiveFilterType, LiveFilterParams, LiveFilterDef } from "./types.js";
import type { CropPresetFn } from "./core/managers/PresetManager.js";

export class EzRen {
  // ── Static utils (delegated from Core) ────────────────────────────────────
  static readonly utils = EzRenCore.utils;

  // ── Core + Runtime ────────────────────────────────────────────────────────
  /** Direct access to the headless core for advanced use cases. */
  readonly core: EzRenCore;

  /** Direct access to the interaction/gizmo runtime. */
  readonly interaction: EzRenInteraction;

  // ─────────────────────────────────────────────────────────────────────────
  constructor(options: EzRenOptions) {
    this.core = new EzRenCore(options);
    this.interaction = new EzRenInteraction(this.core);
  }

  // ── Event delegation ──────────────────────────────────────────────────────

  on<K extends keyof EzRenCoreEvents & string>(
    event: K,
    listener: (payload: EzRenCoreEvents[K]) => void,
  ): this {
    this.core.on(event, listener);
    return this;
  }

  off<K extends keyof EzRenCoreEvents & string>(
    event: K,
    listener: (payload: EzRenCoreEvents[K]) => void,
  ): this {
    this.core.off(event, listener);
    return this;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  get selectedLayerId(): string | null {
    return this.core.selectedLayerId;
  }
  set selectedLayerId(id: string | null) {
    this.core.selectedLayerId = id;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    await this.core.init();
    this.interaction.init();
  }

  destroy(): void {
    this.interaction.destroy();
    this.core.destroy();
  }

  // ── Preset facade ─────────────────────────────────────────────────────────

  public readonly presets = {
    applyFilter: (name: string): Promise<void> => this.core.applyPresetFilter(name),
    applyCrop: (name: string): Promise<void> => this.core.applyPresetCrop(name),
    registerFilter: (name: string, fn: WasmFilterFn): void => this.core.presets.registerFilter(name, fn),
    registerCrop: (name: string, fn: CropPresetFn): void => this.core.presets.registerCrop(name, fn),
    listFilters: (): string[] => this.core.presets.listFilters(),
    listCrops: (): string[] => this.core.presets.listCrops(),
  };

  // ── Filter facade ─────────────────────────────────────────────────────────

  public readonly filters: EzRenCore["filters"] = {
    add: (...args) => this.core.filters.add(...args),
    remove: (...args) => this.core.filters.remove(...args),
    update: (...args) => this.core.filters.update(...args),
    get: (...args) => this.core.filters.get(...args),
  };

  // ── Sugar API (delegated) ─────────────────────────────────────────────────
  setBrightness(layerId: string, value: number): void { this.core.setBrightness(layerId, value); }
  setContrast(layerId: string, value: number): void { this.core.setContrast(layerId, value); }
  setSaturation(layerId: string, value: number): void { this.core.setSaturation(layerId, value); }
  setHue(layerId: string, value: number): void { this.core.setHue(layerId, value); }
  setBlur(layerId: string, strength: number): void { this.core.setBlur(layerId, strength); }
  setOpacity(layerId: string, value: number): void { this.core.setOpacity(layerId, value); }

  // ── Image Layer ───────────────────────────────────────────────────────────

  async addImageLayer(url: string, id?: string): Promise<string> {
    const layerId = await this.core.addImageLayer(url, id);
    // Wire interactivity for the newly added layer
    this.interaction.makeInteractive(layerId);
    return layerId;
  }

  clearLayers(): void {
    this.interaction.gizmo.attach(null);
    this.core.clearLayers();
  }

  selectLayer(id: string): void { this.core.selectLayer(id); }
  moveLayer(id: string, x: number, y: number): void { this.core.moveLayer(id, x, y); }
  bringToFront(id: string): void { this.core.bringToFront(id); }
  sendToBack(id: string): void { this.core.sendToBack(id); }
  reorderLayer(id: string, newZIndex: number): void { this.core.reorderLayer(id, newZIndex); }
  lockLayer(id: string): void { this.core.lockLayer(id); }
  unlockLayer(id: string): void { this.core.unlockLayer(id); }
  setLayerVisible(id: string, visible: boolean): void { this.core.setLayerVisible(id, visible); }

  removeLayer(id: string): void {
    if (this.core.selectedLayerId === id) {
      this.interaction.gizmo.attach(null);
    }
    this.core.removeLayer(id);
  }

  getLayer(id: string): EzLayer | null { return this.core.getLayer(id); }
  getLayers(): ReadonlyMap<string, EzLayer> { return this.core.getLayers(); }

  // ── Transform Proxy ───────────────────────────────────────────────────────

  rotate(degrees: number): void { this.core.rotate(degrees); }
  setRotation(degrees: number): void { this.core.setRotation(degrees); }
  flip(dir: "h" | "v"): void { this.core.flip(dir); }
  resetTransform(): void { this.core.resetTransform(); }
  scale(scaleX: number, scaleY?: number): void { this.core.scale(scaleX, scaleY); }

  get transform(): Readonly<TransformState> | null { return this.core.transform; }

  // ── Coordinate Mappers ────────────────────────────────────────────────────

  canvasToImage(x: number, y: number): Point | null { return this.core.canvasToImage(x, y); }
  getTextureRect(canvasRect: Rect): Rect | null { return this.core.getTextureRect(canvasRect); }

  // ── WASM / Photon ─────────────────────────────────────────────────────────

  registerFilter(name: string, fn: WasmFilterFn): void { this.core.registerFilter(name, fn); }
  async applyWasmFilter(filterName: string): Promise<void> { return this.core.applyWasmFilter(filterName); }
  async syncPixels(buffer: PixelBuffer): Promise<void> { return this.core.syncPixels(buffer); }

  // ── Text Layer ────────────────────────────────────────────────────────────

  addTextLayer(text: string, style?: TextLayerStyle): string {
    const id = this.core.addTextLayer(text, style);
    this.interaction.makeInteractive(id);
    return id;
  }

  removeTextLayer(id: string): void { this.core.removeTextLayer(id); }
  updateTextLayer(id: string, text?: string, style?: TextLayerStyle): void {
    this.core.updateTextLayer(id, text, style);
  }
  getAllTextLayerIds(): string[] { return this.core.getAllTextLayerIds(); }
  getTextLayerInfo(id: string): TextLayerInfo | null { return this.core.getTextLayerInfo(id); }

  // ── Resize / Crop / Extract ───────────────────────────────────────────────

  async resize(width: number, height: number): Promise<void> { return this.core.resize(width, height); }
  async getHistogram(): Promise<HistogramData> { return this.core.getHistogram(); }
  async cloneLayer(): Promise<PixelBuffer> { return this.core.cloneLayer(); }
  async applyCrop(rect: Rect): Promise<void> { return this.core.applyCrop(rect); }
  async extractLayerImageData(): Promise<ImageData | null> { return this.core.extractLayerImageData(); }

  // ── Interactivity (runtime) ───────────────────────────────────────────────

  setInteractive(enabled: boolean): void {
    this.interaction.setInteractive(enabled);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async saveImage(options?: ExportOptions): Promise<Blob | string> {
    // Hide gizmo for the snapshot, then restore
    const wasVisible = this.interaction.gizmo.visible;
    this.interaction.gizmo.visible = false;
    this.core.renderSys.app.render();
    try {
      return await this.core.saveImage(options);
    } finally {
      this.interaction.gizmo.visible = wasVisible;
      if (wasVisible) this.core.renderSys.app.render();
    }
  }

  async exportImage(options?: ExportOptions): Promise<ExportResult> { return this.core.exportImage(options); }
  async exportOverlays(options?: ExportOptions): Promise<ExportResult> { return this.core.exportOverlays(options); }

  // ── Command System ────────────────────────────────────────────────────────

  execute(command: Command): Promise<void> { return this.core.execute(command); }
  async undo(): Promise<boolean> { return this.core.undo(); }
  async redo(): Promise<boolean> { return this.core.redo(); }
  canUndo(): boolean { return this.core.canUndo(); }
  canRedo(): boolean { return this.core.canRedo(); }
  get commandHistory(): readonly Command[] { return this.core.commandHistory; }

  // ── Plugin System ─────────────────────────────────────────────────────────

  use(plugin: EzRenPlugin): this {
    this.core.use(plugin);
    return this;
  }
}
