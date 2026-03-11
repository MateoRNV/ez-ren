import { Application, Container, ApplicationOptions, DestroyOptions } from "pixi.js";
import type { EzRenOptions, PixelBuffer, ExportOptions } from "../../types.js";

export class RenderSystem {
  public app!: Application;
  public readonly canvas: HTMLCanvasElement;
  public mainContainer!: Container;
  public sceneContainer!: Container;

  private isInitialised = false;
  private resizeObserver: ResizeObserver | null = null;
  private options: Required<EzRenOptions>;

  constructor(options: Required<EzRenOptions>) {
    this.canvas = options.canvas;
    this.options = options;
  }

  async init(): Promise<void> {
    this.app = new Application();
    const initOptions: Partial<ApplicationOptions> = {
      canvas: this.canvas,
      width: this.canvas.clientWidth || 800,
      height: this.canvas.clientHeight || 600,
      backgroundColor: this.options.backgroundColor,
      resolution: this.options.resolution,
      antialias: this.options.antialias,
      preference: "webgl",
      autoDensity: true,
    };

    await this.app.init(initOptions);

    this.mainContainer = new Container();
    this.sceneContainer = new Container();
    this.sceneContainer.sortableChildren = true;
    this.mainContainer.addChild(this.sceneContainer);
    this.app.stage.addChild(this.mainContainer);

    this.canvas.style.maxWidth = "100%";
    this.canvas.style.maxHeight = "100%";
    this.canvas.style.display = "block";

    this.isInitialised = true;
  }

  get isReady(): boolean {
    return this.isInitialised;
  }

  resize(onResize: (width: number, height: number) => void): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.isInitialised) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this.app.renderer.resize(width, height);
        onResize(width, height);
      }
    });
    this.resizeObserver.observe(parent);
  }

  extractPixels(target: Container | import("pixi.js").Texture, resolution = 1): PixelBuffer {
    const output = this.app.renderer.extract.pixels({ target, resolution });
    return { 
      data: output.pixels, 
      width: output.width, 
      height: output.height 
    };
  }

  async exportComposition(options: ExportOptions): Promise<Blob | string> {
    const mimeType = options.mimeType ?? "image/png";
    const quality = options.quality ?? 0.95;
    
    // Obtain the native canvas with all shaders applied
    let canvas = this.app.renderer.extract.canvas({ target: this.mainContainer }) as HTMLCanvasElement;

    if (options.dimensions && options.dimensions.width > 0 && options.dimensions.height > 0) {
      const resizedCanvas = document.createElement("canvas");
      resizedCanvas.width = options.dimensions.width;
      resizedCanvas.height = options.dimensions.height;
      const ctx = resizedCanvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(canvas, 0, 0, options.dimensions.width, options.dimensions.height);
      }
      canvas = resizedCanvas;
    }

    const wantsBlob = options.format === "blob";

    if (wantsBlob) {
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to export as Blob"));
        }, mimeType, quality);
      });
    }

    return canvas.toDataURL(mimeType, quality);
  }

  destroy(): void {
    this.isInitialised = false;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const destroyOptions: DestroyOptions = { children: true, texture: true, textureSource: true };
    this.app?.destroy({ removeView: false }, destroyOptions as any);
  }
}
