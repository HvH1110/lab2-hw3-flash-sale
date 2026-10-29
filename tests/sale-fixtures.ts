import type { Clock, FrameScheduler } from '../src/sale/types';
import type { VisibilitySource } from '../src/sale/time';

/** A clock the test moves by hand. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  const clock: Clock = { now: () => now };
  return {
    clock,
    advance: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
    get now() { return now; },
  };
}

/** Animation frames that only run when the test says so. */
export function manualFrames() {
  let next: ((t: number) => void) | null = null;
  let requested = 0;
  let cancelled = 0;
  const scheduler: FrameScheduler = {
    request: (cb) => { next = cb; return ++requested; },
    cancel: () => { next = null; cancelled++; },
  };
  return {
    scheduler,
    frame: () => { const cb = next; next = null; cb?.(0); },
    get pending() { return next !== null; },
    get requested() { return requested; },
    get cancelled() { return cancelled; },
  };
}

export function fakeVisibility() {
  const listeners = new Set<() => void>();
  let state: DocumentVisibilityState = 'visible';
  const source: VisibilitySource = {
    get visibilityState() { return state; },
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
  return {
    source,
    set: (next: DocumentVisibilityState) => { state = next; for (const l of [...listeners]) l(); },
    get listenerCount() { return listeners.size; },
  };
}
