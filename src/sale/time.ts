import type { Clock, FrameScheduler } from './types';

export const systemClock: Clock = { now: () => Date.now() };

export const browserScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

// ---------------------------------------------------------------------------
// Server clock synchronisation
// ---------------------------------------------------------------------------

export interface SyncResult {
  /** serverTime − localTime, in ms. */
  readonly offset: number;
  /** Round trip of the sample that was used; the offset is accurate to ±roundTrip/2. */
  readonly roundTrip: number;
  readonly samples: number;
}

/**
 * NTP-style estimate: for each sample, assume the server read its clock halfway through the
 * round trip. Keep the sample with the shortest round trip, which has the smallest error bound.
 */
export async function estimateServerOffset(serverTime: () => Promise<number>, local: Clock, samples = 5): Promise<SyncResult> {
  let best: { offset: number; roundTrip: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const sent = local.now();
    const server = await serverTime();
    const received = local.now();
    const roundTrip = received - sent;
    const offset = server - (sent + roundTrip / 2);
    if (best === null || roundTrip < best.roundTrip) best = { offset, roundTrip };
  }
  return { offset: best?.offset ?? 0, roundTrip: best?.roundTrip ?? 0, samples };
}

/** A clock that reads the local clock and corrects it to server time. */
export function createSyncedClock(local: Clock, offset: number): Clock {
  return { now: () => local.now() + offset };
}

// ---------------------------------------------------------------------------
// Zero-drift countdown
// ---------------------------------------------------------------------------

/** Minimal document surface for visibility handling (injectable for tests). */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface CountdownOptions {
  /** Absolute deadline on the `clock`'s timeline. */
  readonly target: number;
  readonly clock: Clock;
  readonly onTick: (remainingMs: number) => void;
  readonly onDone?: () => void;
  readonly scheduler?: FrameScheduler;
  /** onTick fires only when the remaining time crosses into a new bucket of this size (default 10 ms = centiseconds). */
  readonly resolutionMs?: number;
  readonly visibility?: VisibilitySource | null;
}

/**
 * requestAnimationFrame countdown that never drifts: every frame recomputes `target − now()`
 * instead of accumulating tick durations, so late, dropped or throttled frames cannot add error.
 * Returns a stop function that cancels the frame and removes every listener.
 */
export function createCountdown(options: CountdownOptions): () => void {
  const { target, clock, onTick, onDone } = options;
  const scheduler = options.scheduler ?? browserScheduler;
  const resolution = options.resolutionMs ?? 10;
  const visibility = options.visibility === undefined ? (typeof document === 'undefined' ? null : document) : options.visibility;

  let handle: number | null = null;
  let lastBucket = Number.NaN;
  let stopped = false;

  const tick = (): void => {
    handle = null;
    if (stopped) return;
    const remaining = Math.max(0, target - clock.now());
    const bucket = Math.floor(remaining / resolution);
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      onTick(remaining);
    }
    if (remaining > 0) {
      handle = scheduler.request(tick);
    } else {
      stop();
      onDone?.();
    }
  };

  // Background tabs pause rAF. On return, recompute at once instead of waiting a frame.
  const onVisibility = (): void => {
    if (visibility?.visibilityState !== 'visible' || stopped) return;
    if (handle !== null) scheduler.cancel(handle);
    tick();
  };

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (handle !== null) scheduler.cancel(handle);
    handle = null;
    visibility?.removeEventListener('visibilitychange', onVisibility);
  }

  visibility?.addEventListener('visibilitychange', onVisibility);
  tick();
  return stop;
}

/** Slide contract: count down `durationMs` from now. */
export function createAntiDriftTimer(
  durationMs: number,
  onTick: (remainingMs: number) => void,
  options: Omit<CountdownOptions, 'target' | 'onTick' | 'clock'> & { readonly clock?: Clock } = {},
): () => void {
  const clock = options.clock ?? systemClock;
  return createCountdown({ ...options, clock, target: clock.now() + durationMs, onTick });
}

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

/** "HH:MM:SS.cs" (centiseconds, floored so it never shows more time than is left); days are prefixed when ≥ 24 h. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const centis = Math.floor((total % 1000) / 10);
  const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
  return days > 0 ? `${days}d ${clock}` : clock;
}

export interface TickerOptions {
  readonly clock: Clock;
  readonly onTick: (now: number) => void;
  /** onTick fires when `now` enters a new bucket of this size. */
  readonly resolutionMs: number;
  readonly scheduler?: FrameScheduler | undefined;
}

/**
 * Open-ended zero-drift ticker: every frame reads the clock and reports `now` when the visible
 * bucket changes. Like createCountdown, it never accumulates frame durations. Returns stop().
 */
export function createTicker({ clock, onTick, resolutionMs, scheduler: injected }: TickerOptions): () => void {
  const scheduler = injected ?? browserScheduler;
  let handle: number | null = null;
  let lastBucket = Number.NaN;
  let stopped = false;
  const tick = (): void => {
    if (stopped) return;
    const now = clock.now();
    const bucket = Math.floor(now / resolutionMs);
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      onTick(now);
    }
    handle = scheduler.request(tick);
  };
  tick();
  return () => {
    stopped = true;
    if (handle !== null) scheduler.cancel(handle);
    handle = null;
  };
}
