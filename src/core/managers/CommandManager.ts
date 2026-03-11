import type { Command } from "../../types.js";

export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  readonly maxHistory: number;

  /** Callback invoked after every execute/undo/redo so EzRenCore can emit 'history:change'. */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;

  constructor(maxHistory = 50) {
    this.maxHistory = maxHistory;
  }

  async execute(command: Command): Promise<void> {
    await Promise.resolve(command.execute());
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift()?.dispose?.();
    }
    // Dispose every command being permanently discarded from the redo branch
    for (const cmd of this.redoStack) cmd.dispose?.();
    this.redoStack = [];
    this.onHistoryChange?.({ canUndo: this.canUndo(), canRedo: this.canRedo() });
  }

  async undo(): Promise<boolean> {
    const command = this.undoStack.pop();
    if (!command) return false;
    await Promise.resolve(command.undo());
    this.redoStack.push(command);
    this.onHistoryChange?.({ canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  async redo(): Promise<boolean> {
    const command = this.redoStack.pop();
    if (!command) return false;
    await Promise.resolve(command.execute());
    this.undoStack.push(command);
    this.onHistoryChange?.({ canUndo: this.canUndo(), canRedo: this.canRedo() });
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get history(): readonly Command[] {
    return this.undoStack;
  }

  clear(): void {
    for (const cmd of this.undoStack) cmd.dispose?.();
    for (const cmd of this.redoStack) cmd.dispose?.();
    this.undoStack = [];
    this.redoStack = [];
    this.onHistoryChange?.({ canUndo: false, canRedo: false });
  }
}
