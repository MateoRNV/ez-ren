/**
 * Lightweight, typed event emitter for EzRenCore.
 * Zero external dependencies; safe to use in headless / SSR environments.
 */

type Listener = (...args: never[]) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<EventMap extends Record<string, any> = Record<string, any>> {
  private _listeners = new Map<string, Set<Listener>>();
  /**
   * Maps (event, originalListener) → onceWrapper so that off() can
   * remove a once-registered listener by its original reference.
   * Keyed per-event so removeAllListeners(event) only clears the
   * wrappers for that specific event.
   */
  private _onceWrappers = new Map<string, Map<Listener, Listener>>();

  on<K extends keyof EventMap & string>(
    event: K,
    listener: (payload: EventMap[K]) => void
  ): this {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(listener as Listener);
    return this;
  }

  once<K extends keyof EventMap & string>(
    event: K,
    listener: (payload: EventMap[K]) => void
  ): this {
    const wrapper = ((payload: EventMap[K]) => {
      this.off(event, listener);
      listener(payload);
    }) as Listener;

    let eventWrappers = this._onceWrappers.get(event);
    if (!eventWrappers) {
      eventWrappers = new Map();
      this._onceWrappers.set(event, eventWrappers);
    }
    eventWrappers.set(listener as Listener, wrapper);

    return this.on(event, wrapper as (payload: EventMap[K]) => void);
  }

  off<K extends keyof EventMap & string>(
    event: K,
    listener: (payload: EventMap[K]) => void
  ): this {
    const set = this._listeners.get(event);
    if (!set) return this;

    // Try removing the listener directly (registered via on())
    if (set.delete(listener as Listener)) {
      // Also clean the once wrapper entry if it existed
      this._onceWrappers.get(event)?.delete(listener as Listener);
      return this;
    }

    // If it was registered via once(), remove the wrapper instead
    const eventWrappers = this._onceWrappers.get(event);
    if (eventWrappers) {
      const wrapper = eventWrappers.get(listener as Listener);
      if (wrapper) {
        set.delete(wrapper);
        eventWrappers.delete(listener as Listener);
      }
    }

    return this;
  }

  emit<K extends keyof EventMap & string>(event: K, payload: EventMap[K]): this {
    const set = this._listeners.get(event);
    if (set) {
      for (const fn of set) (fn as (payload: EventMap[K]) => void)(payload);
    }
    return this;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
      this._onceWrappers.delete(event);
    } else {
      this._listeners.clear();
      this._onceWrappers.clear();
    }
    return this;
  }
}
