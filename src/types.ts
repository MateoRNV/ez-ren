/**
 * ez-ren – Agnostic Image Editing Engine
 * Public types and interfaces
 */

import type { Container, Application } from "pixi.js";

// ─────────────────────────────────────────────────────────────────────────────
// Basic Geometry
// ─────────────────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface EzRenOptions {
  /** Target <canvas> element that Pixi.js will render into. */
  canvas: HTMLCanvasElement;
  /**
   * Background colour in 0xRRGGBB format.
   * @default 0x1a1a2e
   */
  backgroundColor?: number;
  /**
   * Device-pixel-ratio aware resolution.
   * @default window.devicePixelRatio || 1
   */
  resolution?: number;
  /**
   * Whether to enable antialiasing.
   * @default true
   */
  antialias?: boolean;
  /**
   * Maximum number of undo/redo history entries.
   * @default 50
   */
  maxHistory?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transform state
// ─────────────────────────────────────────────────────────────────────────────

export interface TransformState {
  /** Current rotation in degrees (0-359). */
  rotation: number;
  /** Current X scale factor (1 = original size). */
  scaleX: number;
  /** Current Y scale factor (1 = original size). */
  scaleY: number;
  /** X position of the sprite anchor point in pixels. */
  x: number;
  /** Y position of the sprite anchor point in pixels. */
  y: number;
  /** Horizontal flip state */
  flipX?: boolean;
  /** Vertical flip state */
  flipY?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Wasm / Photon filter hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw pixel buffer handed to the WASM filter.
 * Matches the layout of an ImageData.data (Uint8ClampedArray, RGBA).
 */
export interface PixelBuffer {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Signature that every WASM/Photon filter function must satisfy.
 * Receives the pixel buffer, mutates or replaces it, and returns the result.
 */
export type WasmFilterFn = (buffer: PixelBuffer) => PixelBuffer | Promise<PixelBuffer>;

// ─────────────────────────────────────────────────────────────────────────────
// Export options
// ─────────────────────────────────────────────────────────────────────────────

export type ExportFormat = "base64" | "blob";

export interface ExportOptions {
  /**
   * Output format.
   * - `"base64"`: returns a data-URL string (e.g. `data:image/png;base64,…`).
   * - `"blob"`:   returns a `Blob` object.
   * @default "base64"
   */
  format?: ExportFormat;
  /** MIME type of the exported image. @default "image/png" */
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  /** Quality for lossy formats (0.0 to 1.0). @default 0.95 */
  quality?: number;
  /** Optional resize for the exported image. */
  dimensions?: { width: number; height: number };
}

export interface ExportResult {
  format: ExportFormat;
  /** Populated when format === "base64". Null when there are no overlays. */
  data?: string | null;
  /** Populated when format === "blob". */
  blob?: Blob;
  mimeType: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text layer
// ─────────────────────────────────────────────────────────────────────────────

/** Style options for an addTextLayer call. */
export interface TextLayerStyle {
  fill?: string;
  fontSize?: number;
  fontFamily?: string | string[];
  fontWeight?: string | number;
  fontStyle?: string;
}


/** Snapshot of a text layer's current render state. */
export interface TextLayerInfo {
  id: string;
  text: string;
  x: number;
  y: number;
  style: TextLayerStyle;
}

// ─────────────────────────────────────────────────────────────────────────────
// Histogram
// ─────────────────────────────────────────────────────────────────────────────

/** Per-channel histogram data (256 bins each). */
export interface HistogramData {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Perceived luminosity: 0.299R + 0.587G + 0.114B */
  lum: Uint32Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene Graph
// ─────────────────────────────────────────────────────────────────────────────

/** Public snapshot of a scene layer (image or text). */
export interface EzLayer {
  id: string;
  type: "image" | "text";
  /** Optional human-readable label. */
  name?: string;
  /** Whether the layer is rendered. */
  visible: boolean;
  /** If true, the layer is protected from destructive operations. */
  locked: boolean;
  /** Render order — higher values appear on top. */
  zIndex: number;
  /** The underlying PixiJS display object for this layer. */
  container: Container;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command System
// ─────────────────────────────────────────────────────────────────────────────

/** A reversible operation recorded in the command history. */
export interface Command {
  id: string;
  type: "transform" | "filter" | "live-filter" | "crop" | "resize" | "add-layer" | "remove-layer";
  description?: string;
  execute(): void | Promise<void>;
  undo(): void | Promise<void>;
  /**
   * Called when this command is permanently removed from history — either
   * shifted out by maxHistory, cleared from the redo stack after a new
   * execute, or wiped by clear(). Use this to release GPU resources or
   * other non-GC-able references held in closures.
   */
  dispose?(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Filters System (WebGL Shaders)
// ─────────────────────────────────────────────────────────────────────────────

/** Supported live filter types. */
export type LiveFilterType = "blur" | "noise" | "color" | "adjustment";

/** Base params for any live filter. Specific filters can extend this. */
export interface LiveFilterParams {
  [key: string]: any;
}

export interface BlurFilterParams extends LiveFilterParams {
  strength?: number;
}

export interface NoiseFilterParams extends LiveFilterParams {
  noise?: number;
}

export interface ColorFilterParams extends LiveFilterParams {
  brightness?: number; // 0 to 1+ (1 is normal)
  contrast?: number;   // 0 to 1+ (1 is normal)
  saturation?: number; // 0 to 1+ (1 is normal)
  hue?: number;        // degrees (0 to 360)
}

export interface AdjustmentFilterParams extends LiveFilterParams {
  alpha?: number; // 0 to 1
}

export interface LiveFilterDef {
  id: string;
  type: LiveFilterType;
  params: LiveFilterParams;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin System
// ─────────────────────────────────────────────────────────────────────────────

/** Restricted engine API surface exposed to plugins. */
export interface EzRenPluginAPI {
  readonly app: Application;
  getLayers(): ReadonlyMap<string, EzLayer>;
  getSelectedLayerId(): string | null;
  registerFilter(name: string, fn: WasmFilterFn): void;
}

/** Plugin contract: a named object that installs itself via the restricted API. */
export interface EzRenPlugin {
  name: string;
  install(api: EzRenPluginAPI): void;
}
