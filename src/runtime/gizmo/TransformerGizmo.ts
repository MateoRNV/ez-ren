import { Container, Graphics, Ticker, FederatedPointerEvent, Sprite } from "pixi.js";
import type { EzLayerInternal, LayerManager } from "../../core/managers/LayerManager.js";
import type { CommandManager } from "../../core/managers/CommandManager.js";
import type { TransformState } from "../../types.js";

export class TransformerGizmo extends Container {
  public target: EzLayerInternal | null = null;
  private box: Graphics;
  private handles: Record<string, Graphics> = {};

  private cmdManager: CommandManager;
  private layerManager: LayerManager;

  private activeHandle: string | null = null;
  private dragStartData: any = null;

  constructor(cmdManager: CommandManager, layerManager: LayerManager) {
    super();
    this.cmdManager = cmdManager;
    this.layerManager = layerManager;
    this.zIndex = 999999;

    this.box = new Graphics();
    this.box.eventMode = "static";
    this.box.cursor = "move";
    this.box.on("pointerdown", (e: FederatedPointerEvent) => this.onDragStart(e, "center"));
    this.addChild(this.box);

    this.createHandle("tl", "nwse-resize");
    this.createHandle("tr", "nesw-resize");
    this.createHandle("bl", "nesw-resize");
    this.createHandle("br", "nwse-resize");
    this.createHandle("rot", "crosshair");

    this.eventMode = "static";
    this.on("globalpointermove", this.onDragMove);

    // Use window listener to catch pointer releases over React UI panels outside the canvas
    window.addEventListener("pointerup", this.onDragEnd);

    Ticker.shared.add(this.onTick, this);
  }

  destroy(options?: any) {
    Ticker.shared.remove(this.onTick, this);
    window.removeEventListener("pointerup", this.onDragEnd);
    super.destroy(options);
  }

  attach(layer: EzLayerInternal | null) {
    this.target = layer;
    this.visible = !!layer;
    this.onTick();
  }

  private createHandle(id: string, cursor: string) {
    const h = new Graphics();
    h.beginFill(0xffffff).lineStyle(2, 0x00aaff, 1).drawCircle(0, 0, 8).endFill();
    h.eventMode = "static";
    h.cursor = cursor;
    h.on("pointerdown", (e: FederatedPointerEvent) => this.onDragStart(e, id));
    this.handles[id] = h;
    this.addChild(h);
  }

  private onTick = () => {
    if (!this.target) {
      this.visible = false;
      return;
    }
    this.visible = true;

    const obj = this.target.displayObject;
    this.position.set(obj.x, obj.y);
    this.rotation = obj.rotation;

    let w = 0, h = 0;
    if (this.target.type === "text") {
      w = obj.width / Math.abs(obj.scale.x);
      h = obj.height / Math.abs(obj.scale.y);
      w += 10;
      h += 10;
    } else {
      const tex = (obj as Sprite).texture;
      const fitScale = this.target.fitScale ?? 1;
      const tf = this.target.transform!;
      w = (tex ? tex.width : obj.width) * fitScale * tf.scaleX;
      h = (tex ? tex.height : obj.height) * fitScale * tf.scaleY;
    }

    const hw = Math.abs(w / 2);
    const hh = Math.abs(h / 2);

    this.box.clear();
    this.box.lineStyle(2, 0x00aaff, 1);
    this.box.beginFill(0, 0.001); // Invisible tap area
    this.box.drawRect(-hw, -hh, Math.abs(w), Math.abs(h));

    this.box.moveTo(0, -hh);
    this.box.lineTo(0, -hh - 35);
    this.box.endFill();

    this.handles.tl.position.set(-hw, -hh);
    this.handles.tr.position.set(hw, -hh);
    this.handles.bl.position.set(-hw, hh);
    this.handles.br.position.set(hw, hh);
    this.handles.rot.position.set(0, -hh - 35);
  };

  private onDragStart = (e: FederatedPointerEvent, handleId: string) => {
    if (!this.target || this.target.locked) return;
    this.activeHandle = handleId;
    e.stopPropagation();

    const obj = this.target.displayObject;
    const initialTransform = this.target.transform ? { ...this.target.transform } : null;
    const fallbackData = !initialTransform ? { x: obj.x, y: obj.y } : null;

    this.dragStartData = {
      mouseX: e.global.x,
      mouseY: e.global.y,
      objX: obj.x,
      objY: obj.y,
      objRot: obj.rotation,
      scaleX: this.target.transform ? this.target.transform.scaleX : obj.scale.x,
      scaleY: this.target.transform ? this.target.transform.scaleY : obj.scale.y,
      initialTransform,
      fallbackData,
    };
  };

  private onDragMove = (e: FederatedPointerEvent) => {
    if (!this.activeHandle || !this.target || !this.dragStartData || this.target.locked) return;

    // Technical Debt (Zoom / Camera):
    // Currently assumes stage scale is 1:1. If viewport zoom is implemented later,
    // dx/dy need to be mapped using obj.parent.toLocal(e.global) to account for camera scale.
    const dx = e.global.x - this.dragStartData.mouseX;
    const dy = e.global.y - this.dragStartData.mouseY;
    const obj = this.target.displayObject;

    if (this.activeHandle === "center") {
      obj.x = this.dragStartData.objX + dx;
      obj.y = this.dragStartData.objY + dy;
      if (this.target.transform) {
        this.target.transform.x = obj.x;
        this.target.transform.y = obj.y;
      }
    } else if (this.activeHandle === "rot") {
      const cx = this.dragStartData.objX;
      const cy = this.dragStartData.objY;
      const startAngle = Math.atan2(this.dragStartData.mouseY - cy, this.dragStartData.mouseX - cx);
      const currAngle = Math.atan2(e.global.y - cy, e.global.x - cx);
      const diff = currAngle - startAngle;

      const newRot = this.dragStartData.objRot + diff;
      obj.rotation = newRot;
      if (this.target.transform) {
        this.target.transform.rotation = newRot * (180 / Math.PI);
      }
    } else {
      const distStart = Math.hypot(
        this.dragStartData.mouseX - this.dragStartData.objX,
        this.dragStartData.mouseY - this.dragStartData.objY,
      ) || 1;
      const distCurr = Math.hypot(e.global.x - this.dragStartData.objX, e.global.y - this.dragStartData.objY);

      const ratio = distCurr / distStart;
      const newSx = Math.max(0.01, this.dragStartData.scaleX * ratio);
      const newSy = Math.max(0.01, this.dragStartData.scaleY * ratio);

      if (this.target.transform) {
        this.target.transform.scaleX = newSx;
        this.target.transform.scaleY = newSy;
        this.layerManager.syncLayerTransform(this.target.id);
      } else {
        obj.scale.set(newSx, newSy);
      }
    }
  };

  private onDragEnd = (_e?: any) => {
    if (!this.activeHandle || !this.target || !this.dragStartData) return;

    const id = this.target.id;
    const beforeState = this.dragStartData.initialTransform
      ? { ...this.dragStartData.initialTransform }
      : this.dragStartData.fallbackData;
    const afterState = this.target.transform
      ? { ...this.target.transform }
      : { x: this.target.displayObject.x, y: this.target.displayObject.y };
    const layerManager = this.layerManager;

    let changed = false;
    if (this.target.transform) {
      if (
        this.target.transform.x !== this.dragStartData.objX ||
        this.target.transform.y !== this.dragStartData.objY ||
        this.target.transform.rotation !== this.dragStartData.objRot * (180 / Math.PI) ||
        this.target.transform.scaleX !== this.dragStartData.scaleX ||
        this.target.transform.scaleY !== this.dragStartData.scaleY
      ) {
        changed = true;
      }
    } else {
      if (
        this.target.displayObject.x !== this.dragStartData.objX ||
        this.target.displayObject.y !== this.dragStartData.objY
      ) {
        changed = true;
      }
    }

    if (changed) {
      // Command is recorded ONLY on drag-end, keeping history clean.
      this.cmdManager.execute({
        id: crypto.randomUUID(),
        type: "transform",
        description: `drag ${this.activeHandle}`,
        execute: () => {
          const l = layerManager.getLayer(id);
          if (!l) return;
          if (l.type === "image" && l.transform) {
            Object.assign(l.transform, afterState);
            layerManager.syncLayerTransform(id);
          } else {
            l.displayObject.x = (afterState as any).x;
            l.displayObject.y = (afterState as any).y;
          }
        },
        undo: () => {
          const l = layerManager.getLayer(id);
          if (!l) return;
          if (l.type === "image" && l.transform) {
            Object.assign(l.transform, beforeState);
            layerManager.syncLayerTransform(id);
          } else {
            l.displayObject.x = (beforeState as any).x;
            l.displayObject.y = (beforeState as any).y;
          }
        },
      });
    }

    this.activeHandle = null;
    this.dragStartData = null;
  };
}
