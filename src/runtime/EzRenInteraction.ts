/**
 * EzRenInteraction — Runtime layer for interactive canvas editing.
 *
 * Wraps an EzRenCore instance and adds:
 *  - Pointer-event wiring (click-to-select, deselect by clicking background)
 *  - TransformerGizmo lifecycle (attach / detach / Ticker update)
 *  - `makeInteractive()` helper so layers respond to pointer events
 *
 * Usage:
 *  ```ts
 *  const core = new EzRenCore({ canvas });
 *  await core.init();
 *
 *  const interaction = new EzRenInteraction(core);
 *  interaction.init();
 *
 *  const layerId = await core.addImageLayer('photo.jpg');
 *  interaction.makeInteractive(layerId);   // called automatically if you use EzRen facade
 *  ```
 */

import { FederatedPointerEvent, Ticker } from "pixi.js";
import type { EzRenCore } from "../core/EzRenCore.js";
import { TransformerGizmo } from "./gizmo/TransformerGizmo.js";

export class EzRenInteraction {
  /** The visual transformer gizmo rendered on top of the scene. */
  public readonly gizmo: TransformerGizmo;

  private core: EzRenCore;
  private _initialised = false;

  constructor(core: EzRenCore) {
    this.core = core;
    this.gizmo = new TransformerGizmo(core.commands, core.layers);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Call once after `core.init()`.
   * Adds the gizmo to the scene and wires all pointer events.
   */
  init(): void {
    if (this._initialised) return;
    this._initialised = true;

    const { renderSys, layers } = this.core;

    // Add gizmo on top of the scene
    renderSys.sceneContainer.addChild(this.gizmo);

    // Keep the gizmo z-index dominant and sync selection every frame
    Ticker.shared.add(this._checkSelection, this);

    // Background click → deselect
    renderSys.app.stage.eventMode = "static";
    renderSys.app.stage.hitArea = renderSys.app.screen;
    renderSys.app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
      const target = e.target as any;
      if (
        target === renderSys.app.stage ||
        target === renderSys.sceneContainer ||
        target === renderSys.mainContainer
      ) {
        this.core.selectedLayerId = null;
      }
    });
  }

  /**
   * Registers pointer listeners on a layer so clicking it selects it
   * and the gizmo attaches to it.
   *
   * Called automatically by `EzRen` (the full facade) when adding a layer.
   * In headless use of EzRenCore alone, you don't need to call this.
   */
  makeInteractive(layerId: string): void {
    const layer = this.core.layers.getLayer(layerId);
    if (!layer) return;

    layer.displayObject.eventMode = "static";
    layer.displayObject.cursor = "pointer";

    layer.displayObject.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      this.core.selectedLayerId = layerId;
    });
  }

  /**
   * Enable or disable interactivity on all existing layers.
   * Mirrors the old `EzRen.setInteractive()` behaviour.
   */
  setInteractive(enabled: boolean): void {
    const { renderSys, layers } = this.core;
    renderSys.app.stage.eventMode = enabled ? "static" : "passive";

    for (const layer of layers.getAll().values()) {
      layer.displayObject.eventMode = enabled ? "static" : "none";
      layer.displayObject.cursor = enabled ? "pointer" : "default";
    }

    this.gizmo.visible = enabled ? !!this.core.selectedLayerId : false;
  }

  /**
   * Detach gizmo and remove all Ticker / event listeners.
   * Safe to call multiple times.
   */
  destroy(): void {
    if (!this._initialised) return;
    Ticker.shared.remove(this._checkSelection, this);
    this.gizmo.destroy({ children: true });
    this._initialised = false;
  }

  // ── Private: Ticker callback ──────────────────────────────────────────────

  /**
   * Runs every frame on the GPU Ticker.
   * Keeps gizmo z-index dominant and attaches / detaches it based on selection.
   */
  private _checkSelection = () => {
    const { renderSys } = this.core;

    if (this.gizmo.zIndex !== 999999) {
      this.gizmo.zIndex = 999999;
      renderSys.sceneContainer.sortChildren();
    }

    const selectedId = this.core.selectedLayerId;
    if (selectedId) {
      const layer = this.core.layers.getLayer(selectedId);
      if (this.gizmo.target !== layer) {
        this.gizmo.attach(layer || null);
      }
    } else {
      if (this.gizmo.target !== null) {
        this.gizmo.attach(null);
      }
    }
  };
}
