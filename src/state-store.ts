import type { Renderer } from './types';

/**
 * External state memory. Components are re-executed from scratch on every render;
 * their state survives here, addressed by the order in which hooks are called.
 */
interface StateStore {
  readonly states: unknown[];
  /** Index of the next hook slot in the current render pass. */
  cursor: number;
  rendering: boolean;
  /** Hooks used by the last committed render (null before the first commit). */
  committedHookCount: number | null;
  renderer: Renderer;
  /** Incremented on every reset; setters from an older generation are stale. */
  generation: number;
}

const noopRenderer: Renderer = () => {};

const store: StateStore = {
  states: [],
  cursor: 0,
  rendering: false,
  committedHookCount: null,
  renderer: noopRenderer,
  generation: 0,
};

/** Installs the function that re-renders the app when state changes. */
export function setRenderer(renderer: Renderer): void {
  store.renderer = renderer;
}

export function triggerRender(): void {
  store.renderer();
}

/** Starts a render pass: hooks are read from slot 0 again. */
export function resetCursor(): void {
  store.cursor = 0;
  store.rendering = true;
}

/** Ends a render pass and enforces the call-order invariant of the Rules of Hooks. */
export function commitRender(): void {
  if (!store.rendering) throw new Error('commitRender: no render pass in progress');
  store.rendering = false;

  const used = store.cursor;
  const expected = store.committedHookCount;
  if (expected !== null && used !== expected) {
    throw new Error(
      `Rules of Hooks violated: this render called ${used} hook(s) but the previous render called ${expected}. ` +
        'Hooks must not be called conditionally, in loops or in nested functions.',
    );
  }
  store.committedHookCount = used;
}

/** Ends a render pass that threw, without recording its (partial) hook count. */
export function abortRender(): void {
  store.rendering = false;
}

export function currentGeneration(): number {
  return store.generation;
}

export function isRendering(): boolean {
  return store.rendering;
}

/** Reserves the next hook slot for the hook being called right now. */
export function claimHookSlot(): number {
  if (!store.rendering) {
    throw new Error('Invalid hook call: hooks can only be called while a component is rendering.');
  }
  const slot = store.cursor;
  store.cursor++;
  return slot;
}

export function hasSlot(slot: number): boolean {
  return slot < store.states.length;
}

export function readSlot<T>(slot: number): T {
  return store.states[slot] as T;
}

export function writeSlot(slot: number, value: unknown): void {
  store.states[slot] = value;
}

/** Read-only snapshot for tests and DevTools inspection. */
export function inspectStateStore(): { states: readonly unknown[]; cursor: number; rendering: boolean } {
  return { states: [...store.states], cursor: store.cursor, rendering: store.rendering };
}

/** Clears all state (tests, or unmounting the app). */
export function resetStateStore(): void {
  store.states.length = 0;
  store.cursor = 0;
  store.rendering = false;
  store.committedHookCount = null;
  store.renderer = noopRenderer;
  store.generation++;
}
