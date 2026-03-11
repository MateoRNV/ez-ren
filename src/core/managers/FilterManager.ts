import { BlurFilter, NoiseFilter, ColorMatrixFilter, AlphaFilter, Filter } from "pixi.js";
import type {
  LiveFilterType,
  LiveFilterParams,
  LiveFilterDef,
  BlurFilterParams,
  NoiseFilterParams,
  ColorFilterParams,
  AdjustmentFilterParams
} from "../../types.js";
import type { LayerManager } from "./LayerManager.js";
import type { CommandManager } from "./CommandManager.js";

// Internal mapping of filter definitions to actual PIXI references
interface ActiveFilter {
  def: LiveFilterDef;
  pixiFilter: Filter;
}

export class FilterManager {
  // Mapping layerId -> active filters
  private activeFilters = new Map<string, ActiveFilter[]>();

  constructor(
    private layerManager: LayerManager,
    private cmdManager: CommandManager
  ) {}

  addEffect(layerId: string, type: LiveFilterType, params: LiveFilterParams = {}): string {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer || layer.locked) throw new Error(`[EzRen] Cannot apply filter. Layer is missing or locked.`);

    const effectId = crypto.randomUUID();
    const def: LiveFilterDef = { id: effectId, type, params: { ...params } };
    const pixiFilter = this.createPixiFilter(type, params);
    const entry: ActiveFilter = { def, pixiFilter };

    // The command's execute() is the sole executor — no pre-application.
    this.cmdManager.execute({
      id: crypto.randomUUID(),
      type: "live-filter",
      description: `add ${type} filter`,
      execute: () => {
        let f = this.activeFilters.get(layerId);
        if (!f) {
          f = [];
          this.activeFilters.set(layerId, f);
        }
        if (!f.some(x => x.def.id === effectId)) {
          f.push(entry);
          this.syncLayerFilters(layerId);
        }
      },
      undo: () => {
        const f = this.activeFilters.get(layerId);
        if (f) {
          const idx = f.findIndex(x => x.def.id === effectId);
          if (idx > -1) {
            f.splice(idx, 1);
            this.syncLayerFilters(layerId);
          }
        }
      },
      dispose: () => {
        if (!this._isFilterActive(pixiFilter)) pixiFilter.destroy();
      },
    });

    return effectId;
  }

  removeEffect(layerId: string, effectId: string): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer || layer.locked) return;

    const filters = this.activeFilters.get(layerId);
    if (!filters) return;

    const idx = filters.findIndex(f => f.def.id === effectId);
    if (idx === -1) return;

    const removedEntry = filters[idx];
    const defSnapshot = { ...removedEntry.def, params: { ...removedEntry.def.params } };
    const pixiFilterRef = removedEntry.pixiFilter;
    const insertIdx = idx;

    // The command's execute() is the sole executor — no pre-removal.
    this.cmdManager.execute({
      id: crypto.randomUUID(),
      type: "live-filter",
      description: `remove ${defSnapshot.type} filter`,
      execute: () => {
        const f = this.activeFilters.get(layerId);
        if (f) {
          const i = f.findIndex(x => x.def.id === effectId);
          if (i > -1) {
            f.splice(i, 1);
            this.syncLayerFilters(layerId);
          }
        }
      },
      undo: () => {
        let f = this.activeFilters.get(layerId);
        if (!f) {
          f = [];
          this.activeFilters.set(layerId, f);
        }
        f.splice(insertIdx, 0, { def: defSnapshot, pixiFilter: pixiFilterRef });
        this.syncLayerFilters(layerId);
      },
      dispose: () => {
        if (!this._isFilterActive(pixiFilterRef)) pixiFilterRef.destroy();
      },
    });
  }

  updateEffect(layerId: string, effectId: string, params: LiveFilterParams): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer || layer.locked) return;

    const filters = this.activeFilters.get(layerId);
    if (!filters) return;

    const filterObj = filters.find(f => f.def.id === effectId);
    if (!filterObj) return;

    const beforeParams = { ...filterObj.def.params };
    const afterParams = { ...beforeParams, ...params };

    // The command's execute() is the sole executor — no pre-update.
    this.cmdManager.execute({
      id: crypto.randomUUID(),
      type: "live-filter",
      description: `update ${filterObj.def.type} filter`,
      execute: () => {
        const f = this.activeFilters.get(layerId)?.find(x => x.def.id === effectId);
        if (f) {
          f.def.params = { ...afterParams };
          this.applyPixiFilterParams(f.pixiFilter, f.def.type, afterParams);
        }
      },
      undo: () => {
        const f = this.activeFilters.get(layerId)?.find(x => x.def.id === effectId);
        if (f) {
          f.def.params = { ...beforeParams };
          this.applyPixiFilterParams(f.pixiFilter, f.def.type, beforeParams);
        }
      }
    });
  }

  getEffects(layerId: string): LiveFilterDef[] {
    const filters = this.activeFilters.get(layerId);
    return filters ? filters.map(f => ({ ...f.def, params: { ...f.def.params } })) : [];
  }

  private syncLayerFilters(layerId: string): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    const filters = this.activeFilters.get(layerId);
    if (!filters || filters.length === 0) {
      layer.displayObject.filters = null;
    } else {
      layer.displayObject.filters = filters.map(f => f.pixiFilter);
    }
  }

  private createPixiFilter(type: LiveFilterType, params: LiveFilterParams): Filter {
    let filter: Filter;
    switch (type) {
      case "blur":
        filter = new BlurFilter();
        break;
      case "noise":
        filter = new NoiseFilter();
        break;
      case "color":
        filter = new ColorMatrixFilter();
        break;
      case "adjustment":
        filter = new AlphaFilter();
        break;
      default:
        throw new Error(`[EzRen] Unknown filter type: ${type}`);
    }
    this.applyPixiFilterParams(filter, type, params);
    return filter;
  }

  private applyPixiFilterParams(filter: Filter, type: LiveFilterType, params: LiveFilterParams): void {
    switch (type) {
      case "blur": {
        const p = params as BlurFilterParams;
        if (p.strength !== undefined) (filter as BlurFilter).blur = p.strength;
        break;
      }
      case "noise": {
        const p = params as NoiseFilterParams;
        if (p.noise !== undefined) (filter as NoiseFilter).noise = p.noise;
        break;
      }
      case "color": {
        const p = params as ColorFilterParams;
        const colorMatrix = filter as ColorMatrixFilter;
        // Reset to identity first, then chain all ops with multiply=true so
        // each operation accumulates on top of the previous one instead of
        // replacing the entire matrix (multiply=false would only keep the last call).
        colorMatrix.reset();
        if (p.brightness !== undefined) colorMatrix.brightness(p.brightness, true);
        if (p.contrast   !== undefined) colorMatrix.contrast(p.contrast, true);
        if (p.saturation !== undefined) colorMatrix.saturate(p.saturation, true);
        if (p.hue        !== undefined) colorMatrix.hue(p.hue, true);
        break;
      }
      case "adjustment": {
        const p = params as AdjustmentFilterParams;
        if (p.alpha !== undefined) (filter as AlphaFilter).alpha = p.alpha;
        break;
      }
    }
  }

  /** Returns true if the given filter instance is currently applied to any layer. */
  private _isFilterActive(filter: Filter): boolean {
    for (const filters of this.activeFilters.values()) {
      if (filters.some(f => f.pixiFilter === filter)) return true;
    }
    return false;
  }

  clearAll(): void {
    // Sync display objects before destroying — prevents layers from
    // referencing already-destroyed filter instances.
    for (const layerId of this.activeFilters.keys()) {
      const layer = this.layerManager.getLayer(layerId);
      if (layer) layer.displayObject.filters = null;
    }
    for (const filters of this.activeFilters.values()) {
      for (const entry of filters) {
        entry.pixiFilter.destroy();
      }
    }
    this.activeFilters.clear();
  }
}
