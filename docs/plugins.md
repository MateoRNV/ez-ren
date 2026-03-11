# Plugin System

EzRen's plugin system lets you extend the engine with custom filters, crop presets, or any logic that accesses the PixiJS application. Plugins are registered via a **restricted API surface** — they cannot access engine internals directly.

---

## Creating a Plugin

A plugin is a plain object with a `name` and an `install` function:

```typescript
import type { EzRenPlugin } from "ez-ren";

const myPlugin: EzRenPlugin = {
  name: "my-plugin",
  install(api) {
    // Register custom filters
    api.registerFilter("neon", (buffer) => {
      const { data } = buffer;
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = 255 - data[i];     // invert R
        data[i + 2] = 255 - data[i + 2]; // invert B
      }
      return buffer;
    });
  },
};
```

---

## Registering a Plugin

```typescript
engine.use(myPlugin);
```

`use()` is idempotent — installing the same plugin twice (by `name`) is silently ignored.  
It returns `this`, so you can chain:

```typescript
engine.use(pluginA).use(pluginB).use(pluginC);
```

---

## Plugin API Surface

The `install` function receives an `EzRenPluginAPI` object, which provides a **controlled subset** of the engine's capabilities:

```typescript
interface EzRenPluginAPI {
  readonly app: Application;          // The PixiJS Application instance
  getLayers(): ReadonlyMap<string, EzLayer>;
  getSelectedLayerId(): string | null;
  registerFilter(name: string, fn: WasmFilterFn): void;
}
```

This design is intentional — plugins can access layers and register filters, but cannot bypass the command system or modify internal state directly.

---

## Plugin Examples

### Vintage Color Effect

```typescript
const vintagePlugin: EzRenPlugin = {
  name: "vintage",
  install(api) {
    api.registerFilter("vintage", (buffer) => {
      const { data } = buffer;
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, data[i] * 1.08 + 15);   // warm red
        data[i + 1] = Math.min(255, data[i + 1] * 0.95);    // slight green drop
        data[i + 2] = Math.max(0,   data[i + 2] * 0.80);    // reduce blue
      }
      return buffer;
    });
  },
};

engine.use(vintagePlugin);
await engine.presets.applyFilter("vintage");
```

### Custom PixiJS Stage Overlay (using `api.app`)

```typescript
import { Graphics } from "pixi.js";

const gridPlugin: EzRenPlugin = {
  name: "grid-overlay",
  install(api) {
    const grid = new Graphics();
    grid.zIndex = 500;
    // Draw a reference grid on the stage
    const { width, height } = api.app.screen;
    for (let x = 0; x < width; x += 100) {
      grid.moveTo(x, 0).lineTo(x, height).stroke({ color: 0xffffff, alpha: 0.1, width: 1 });
    }
    api.app.stage.addChild(grid);
  },
};

engine.use(gridPlugin);
```
