import { Sprite, Text, Assets, DestroyOptions } from "pixi.js";
import type { TransformState, EzLayer } from "../../types.js";
import { RenderSystem } from "../rendering/RenderSystem.js";

export interface EzLayerInternal {
  id: string;
  type: "image" | "text";
  name?: string;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  displayObject: Sprite | Text;
  transform?: TransformState;
  fitScale?: number;
  url?: string;
}

export class LayerManager {
  private layerRegistry = new Map<string, EzLayerInternal>();
  public selectedLayerId: string | null = null;
  public imgZIndex = 0;
  public txtZIndex = 1000;

  constructor(private renderSystem: RenderSystem) {}

  addLayer(layer: EzLayerInternal): void {
    this.layerRegistry.set(layer.id, layer);
    this.renderSystem.sceneContainer.addChild(layer.displayObject);
    this.renderSystem.sceneContainer.sortChildren();
  }

  getLayer(id: string): EzLayerInternal | undefined {
    return this.layerRegistry.get(id);
  }

  getAll(): Map<string, EzLayerInternal> {
    return this.layerRegistry;
  }

  removeLayer(id: string): void {
    const layer = this.layerRegistry.get(id);
    if (!layer) return;

    this.renderSystem.sceneContainer.removeChild(layer.displayObject);

    if (layer.type === "image") {
      if (layer.url && !layer.url.startsWith("blob:") && !layer.url.startsWith("data:")) {
        Assets.unload(layer.url).catch(() => {});
      }
      (layer.displayObject as Sprite).destroy({ texture: true, textureSource: true } as DestroyOptions);
    } else {
      layer.displayObject.destroy();
    }

    this.layerRegistry.delete(id);
    if (this.selectedLayerId === id) this.selectedLayerId = null;
  }

  reorder(id: string, newZIndex: number): void {
    const layer = this.layerRegistry.get(id);
    if (!layer) return;
    layer.zIndex = newZIndex;
    layer.displayObject.zIndex = newZIndex;
    this.renderSystem.sceneContainer.sortChildren();
  }

  clearLayers(): void {
    for (const layer of this.layerRegistry.values()) {
      this.renderSystem.sceneContainer.removeChild(layer.displayObject);
      if (layer.type === "image") {
        if (layer.url && !layer.url.startsWith("blob:") && !layer.url.startsWith("data:")) {
          Assets.unload(layer.url).catch(() => {});
        }
        (layer.displayObject as Sprite).destroy({ texture: true, textureSource: true } as DestroyOptions);
      } else {
        layer.displayObject.destroy();
      }
    }
    this.layerRegistry.clear();
    this.selectedLayerId = null;
    this.imgZIndex = 0;
    this.txtZIndex = 1000;
  }

  syncLayerTransform(id: string): void {
    const layer = this.layerRegistry.get(id);
    if (!layer || layer.type !== "image") return;

    const sprite = layer.displayObject as Sprite;
    const transform = layer.transform!;

    sprite.anchor.set(0.5, 0.5);
    sprite.rotation = (transform.rotation * Math.PI) / 180;
    const fitScale = layer.fitScale ?? 1;
    const signX = transform.flipX ? -1 : 1;
    const signY = transform.flipY ? -1 : 1;
    sprite.scale.set(signX * fitScale * transform.scaleX, signY * fitScale * transform.scaleY);
    sprite.x = transform.x;
    sprite.y = transform.y;
  }

  fitToStage(id: string): void {
    const layer = this.layerRegistry.get(id);
    if (!layer || layer.type !== "image") return;
    const sprite = layer.displayObject as Sprite;
    const transform = layer.transform!;

    const { width: stageW, height: stageH } = this.renderSystem.app.screen;
    const { width: texW, height: texH } = sprite.texture;

    const padding = 0.9;
    const fitScale = Math.min(
      (stageW * padding) / texW,
      (stageH * padding) / texH,
      1,
    );

    layer.fitScale = fitScale;
    const signX = transform.flipX ? -1 : 1;
    const signY = transform.flipY ? -1 : 1;
    sprite.scale.set(signX * fitScale * transform.scaleX, signY * fitScale * transform.scaleY);
  }

  centerLayer(id: string): void {
    const layer = this.layerRegistry.get(id);
    if (!layer || layer.type !== "image") return;
    const sprite = layer.displayObject as Sprite;
    const transform = layer.transform!;

    const { width, height } = this.renderSystem.app.screen;
    sprite.x = width / 2;
    sprite.y = height / 2;
    transform.x = sprite.x;
    transform.y = sprite.y;
    this.fitToStage(id);
  }

  toPublicLayer(internal: EzLayerInternal): EzLayer {
    return {
      id: internal.id,
      type: internal.type,
      name: internal.name,
      visible: internal.visible,
      locked: internal.locked,
      zIndex: internal.zIndex,
      container: internal.displayObject,
    };
  }
}
