import { claimHookSlot, currentGeneration, hasSlot, inspectStateStore, readSlot, writeSlot } from './state-store';

export type EffectCleanup = () => void;
export type Effect = () => void | EffectCleanup;
export type DependencyList = readonly unknown[];

const EFFECT = Symbol('effect');

interface EffectRecord {
  readonly [EFFECT]: true;
  deps: DependencyList | undefined;
  cleanup: EffectCleanup | undefined;
}

interface PendingEffect {
  readonly generation: number;
  readonly run: () => void;
}

/** Effects scheduled during the current render, run after the DOM is committed. */
let pending: PendingEffect[] = [];

const isEffectRecord = (value: unknown): value is EffectRecord =>
  typeof value === 'object' && value !== null && EFFECT in value;

const depsChanged = (previous: DependencyList | undefined, next: DependencyList | undefined): boolean =>
  previous === undefined ||
  next === undefined ||
  previous.length !== next.length ||
  next.some((dep, i) => !Object.is(dep, previous[i]));

/**
 * Runs `effect` after the commit in which `deps` changed (every commit when `deps` is omitted,
 * once when it is `[]`). A returned cleanup runs before the next run and on unmount.
 */
export function useEffect(effect: Effect, deps?: DependencyList): void {
  const slot = claimHookSlot();
  const isFirstRender = !hasSlot(slot);
  if (isFirstRender) {
    const record: EffectRecord = { [EFFECT]: true, deps: undefined, cleanup: undefined };
    writeSlot(slot, record);
  }
  const record = readSlot<EffectRecord>(slot);
  if (!isFirstRender && !depsChanged(record.deps, deps)) return;

  pending.push({
    generation: currentGeneration(),
    run: () => {
      record.cleanup?.();
      const cleanup = effect();
      record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      record.deps = deps;
    },
  });
}

/** Runs effects queued by the last committed render, in hook order. */
export function flushEffects(): void {
  const queue = pending;
  pending = [];
  const generation = currentGeneration();
  for (const effect of queue) {
    if (effect.generation === generation) effect.run();
  }
}

/** Drops effects of a render that threw before committing. */
export function discardPendingEffects(): void {
  pending = [];
}

/** Runs every cleanup still registered in the store (unmount). */
export function disposeEffects(): void {
  pending = [];
  for (const value of inspectStateStore().states) {
    if (isEffectRecord(value)) {
      const { cleanup } = value;
      value.cleanup = undefined;
      cleanup?.();
    }
  }
}
