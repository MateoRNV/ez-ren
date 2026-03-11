import type { EzRenPlugin, EzRenPluginAPI } from "../../types.js";

export class PluginManager {
  private readonly installedPlugins = new Set<string>();

  constructor(private api: EzRenPluginAPI) {}

  use(plugin: EzRenPlugin): void {
    if (this.installedPlugins.has(plugin.name)) {
      console.warn(`[EzRen] Plugin "${plugin.name}" is already installed.`);
      return;
    }
    plugin.install(this.api);
    this.installedPlugins.add(plugin.name);
  }

  getPluginAPI(): EzRenPluginAPI {
    return this.api;
  }
}
