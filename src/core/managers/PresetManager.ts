import type { WasmFilterFn, PixelBuffer, Rect } from "../../types.js";

export type CropPresetFn = (width: number, height: number) => Rect;

// ─── Built-in filter implementations ─────────────────────────────────────────
// All filters operate on a Uint8ClampedArray view of the pixel data.
// This guarantees native clamping to [0..255] regardless of whether the
// underlying buffer is Uint8Array (from PixiJS extract) or Uint8ClampedArray.
// Without this, sepia's weighted sums can exceed 255 and wrap via modulo 256
// on Uint8Array, producing completely wrong colours on bright images.

function _ensureClamped(buf: PixelBuffer): Uint8ClampedArray {
  if (buf.data instanceof Uint8ClampedArray) return buf.data;
  return new Uint8ClampedArray(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength);
}

function _grayscale(buf: PixelBuffer): PixelBuffer {
  const data = _ensureClamped(buf);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = luma;
  }
  return buf;
}

function _sepia(buf: PixelBuffer): PixelBuffer {
  const data = _ensureClamped(buf);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i]     = 0.393 * r + 0.769 * g + 0.189 * b;
    data[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    data[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
  }
  return buf;
}

function _invert(buf: PixelBuffer): PixelBuffer {
  const data = _ensureClamped(buf);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
  return buf;
}

function _threshold(buf: PixelBuffer): PixelBuffer {
  const data = _ensureClamped(buf);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const val = luma > 128 ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = val;
  }
  return buf;
}

function _solarize(buf: PixelBuffer): PixelBuffer {
  const data = _ensureClamped(buf);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = data[i]     > 128 ? 255 - data[i]     : data[i];
    data[i + 1] = data[i + 1] > 128 ? 255 - data[i + 1] : data[i + 1];
    data[i + 2] = data[i + 2] > 128 ? 255 - data[i + 2] : data[i + 2];
  }
  return buf;
}

// ─── Built-in crop implementations ───────────────────────────────────────────

function _square(w: number, h: number): Rect {
  const side = Math.min(w, h);
  return {
    x: Math.round((w - side) / 2),
    y: Math.round((h - side) / 2),
    width: side,
    height: side,
  };
}

function _landscape(w: number, h: number): Rect {
  const targetRatio = 16 / 9;
  const currentRatio = w / h;
  let cropW: number, cropH: number;
  if (currentRatio > targetRatio) {
    cropH = h;
    cropW = Math.round(h * targetRatio);
  } else {
    cropW = w;
    cropH = Math.round(w / targetRatio);
  }
  return {
    x: Math.round((w - cropW) / 2),
    y: Math.round((h - cropH) / 2),
    width: cropW,
    height: cropH,
  };
}

function _portrait(w: number, h: number): Rect {
  const targetRatio = 9 / 16;
  const currentRatio = w / h;
  let cropW: number, cropH: number;
  if (currentRatio > targetRatio) {
    cropH = h;
    cropW = Math.round(h * targetRatio);
  } else {
    cropW = w;
    cropH = Math.round(w / targetRatio);
  }
  return {
    x: Math.round((w - cropW) / 2),
    y: Math.round((h - cropH) / 2),
    width: cropW,
    height: cropH,
  };
}

// ─── PresetManager ────────────────────────────────────────────────────────────

export class PresetManager {
  private readonly _filters = new Map<string, WasmFilterFn>();
  private readonly _crops = new Map<string, CropPresetFn>();

  constructor() {
    this._filters.set("grayscale", _grayscale);
    this._filters.set("sepia", _sepia);
    this._filters.set("invert", _invert);
    this._filters.set("threshold", _threshold);
    this._filters.set("solarize", _solarize);

    this._crops.set("square", _square);
    this._crops.set("landscape", _landscape);
    this._crops.set("portrait", _portrait);
    this._crops.set("story", _portrait);
  }

  // ── Filters ──────────────────────────────────────────────────────────────

  registerFilter(name: string, fn: WasmFilterFn): void {
    this._filters.set(name, fn);
  }

  getFilter(name: string): WasmFilterFn | undefined {
    return this._filters.get(name);
  }

  hasFilter(name: string): boolean {
    return this._filters.has(name);
  }

  listFilters(): string[] {
    return Array.from(this._filters.keys());
  }

  // ── Crops ────────────────────────────────────────────────────────────────

  registerCrop(name: string, fn: CropPresetFn): void {
    this._crops.set(name, fn);
  }

  getCrop(name: string, width: number, height: number): Rect | undefined {
    const fn = this._crops.get(name);
    return fn ? fn(width, height) : undefined;
  }

  hasCrop(name: string): boolean {
    return this._crops.has(name);
  }

  listCrops(): string[] {
    return Array.from(this._crops.keys());
  }
}
