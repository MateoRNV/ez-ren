/**
 * ez-ren – public API surface
 *
 * Full interactive facade:
 *   import { EzRen } from "ez-ren";
 *
 * Headless core only (no Gizmo / pointer events):
 *   import { EzRenCore } from "ez-ren";
 *
 * Runtime layer (compose with core manually):
 *   import { EzRenInteraction } from "ez-ren";
 */

// ── Default full-featured facade ──────────────────────────────────────────────
export { EzRen } from "./EzRen.js";

// ── Headless core (for SSR / headless processing pipelines) ───────────────────
export { EzRenCore } from "./core/EzRenCore.js";
export type { EzRenCoreEvents } from "./core/EzRenCore.js";

// ── Runtime interaction layer ─────────────────────────────────────────────────
export { EzRenInteraction } from "./runtime/EzRenInteraction.js";

// ── Gizmo (for custom runtimes) ───────────────────────────────────────────────
export { TransformerGizmo } from "./runtime/gizmo/TransformerGizmo.js";

// ── Preset system ────────────────────────────────────────────────────────────
export type { CropPresetFn } from "./core/managers/PresetManager.js";

// ── Public types ──────────────────────────────────────────────────────────────
export type {
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
  ExportFormat,
  Point,
  Rect,
  TextLayerStyle,
  TextLayerInfo,
  HistogramData,
  LiveFilterType,
  LiveFilterParams,
  LiveFilterDef,
  BlurFilterParams,
  NoiseFilterParams,
  ColorFilterParams,
  AdjustmentFilterParams,
} from "./types.js";
