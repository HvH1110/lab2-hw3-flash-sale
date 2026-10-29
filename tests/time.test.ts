import {
  createAntiDriftTimer,
  createCountdown,
  createSyncedClock,
  estimateServerOffset,
  formatCountdown,
} from '../src/sale/time';
import { fakeClock, fakeVisibility, manualFrames } from './sale-fixtures';

describe('estimateServerOffset', () => {
  it('recovers a server clock 5 s ahead within ±RTT/2, using the fastest round trip', async () => {
    const local = fakeClock();
    const latencies = [[120, 30], [10, 12], [60, 200], [25, 25], [300, 5]]; // [up, down] ms, deliberately asymmetric
    let i = 0;
    const serverTime = async (): Promise<number> => {
      const [up = 0, down = 0] = latencies[i++] ?? [];
      local.advance(up);
      const reading = local.now + 5_000;
      local.advance(down);
      return reading;
    };
    const result = await estimateServerOffset(serverTime, local.clock, 5);
    expect(result.roundTrip).toBe(22); // the [10, 12] sample
    expect(Math.abs(result.offset - 5_000)).toBeLessThanOrEqual(result.roundTrip / 2);
  });

  it('a synced clock reads local time plus the offset', () => {
    const local = fakeClock(1_000);
    const synced = createSyncedClock(local.clock, 250);
    expect(synced.now()).toBe(1_250);
    local.advance(10);
    expect(synced.now()).toBe(1_260);
  });
});

describe('createCountdown: zero drift', () => {
  it('reports target − now on every frame, so janky and throttled frames add no error', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const ticks: number[] = [];
    createCountdown({ target: time.now + 60_000, clock: time.clock, scheduler: frames.scheduler, onTick: (ms) => ticks.push(ms), visibility: null });
    expect(ticks).toEqual([60_000]);

    for (const gap of [16, 17, 16, 250, 16, 5_000, 33]) { // a long task, then a throttled background stretch
      time.advance(gap);
      frames.frame();
    }
    expect(ticks.at(-1)).toBe(60_000 - (16 + 17 + 16 + 250 + 16 + 5_000 + 33));
  });

  it('only calls onTick when the visible centisecond changes', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const onTick = vi.fn();
    // Start mid-bucket: 1005 → 1000 ms all display "00:00:01.00".
    createCountdown({ target: time.now + 1_005, clock: time.clock, scheduler: frames.scheduler, onTick, visibility: null });
    for (let i = 0; i < 5; i++) { time.advance(1); frames.frame(); } // 5 frames inside one 10 ms bucket
    expect(onTick).toHaveBeenCalledTimes(1);
    time.advance(10);
    frames.frame();
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('respects a coarser resolution (e.g. whole seconds)', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const onTick = vi.fn();
    createCountdown({ target: time.now + 3_000, clock: time.clock, scheduler: frames.scheduler, onTick, resolutionMs: 1_000, visibility: null });
    for (let i = 0; i < 100; i++) { time.advance(16); frames.frame(); }
    expect(onTick.mock.calls.map(([ms]) => Math.floor(ms / 1_000))).toEqual([3, 2, 1]);
  });

  it('fires onDone exactly once at zero and stops requesting frames', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const onDone = vi.fn();
    const ticks: number[] = [];
    createCountdown({ target: time.now + 50, clock: time.clock, scheduler: frames.scheduler, onTick: (ms) => ticks.push(ms), onDone, visibility: null });
    time.advance(80); // overshoot: remaining clamps to 0
    frames.frame();
    expect(ticks.at(-1)).toBe(0);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(false);
  });

  it('a target already in the past finishes immediately', () => {
    const time = fakeClock();
    const onDone = vi.fn();
    createCountdown({ target: time.now - 1, clock: time.clock, scheduler: manualFrames().scheduler, onTick: () => {}, onDone, visibility: null });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels the frame and removes the visibility listener', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const visibility = fakeVisibility();
    const onTick = vi.fn();
    const stop = createCountdown({ target: time.now + 10_000, clock: time.clock, scheduler: frames.scheduler, onTick, visibility: visibility.source });
    expect(visibility.listenerCount).toBe(1);
    stop();
    stop();
    expect(frames.pending).toBe(false);
    expect(visibility.listenerCount).toBe(0);
    time.advance(100);
    frames.frame();
    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it('returning to a background tab recomputes immediately (rAF was paused)', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const visibility = fakeVisibility();
    const ticks: number[] = [];
    createCountdown({ target: time.now + 60_000, clock: time.clock, scheduler: frames.scheduler, onTick: (ms) => ticks.push(ms), visibility: visibility.source });
    visibility.set('hidden');
    time.advance(42_000); // no frames while hidden
    visibility.set('visible');
    expect(ticks.at(-1)).toBe(18_000);
  });

  it('the slide signature createAntiDriftTimer(durationMs, onTick) counts down from now', () => {
    const time = fakeClock();
    const frames = manualFrames();
    const ticks: number[] = [];
    createAntiDriftTimer(2_000, (ms) => ticks.push(ms), { clock: time.clock, scheduler: frames.scheduler, visibility: null });
    time.advance(500);
    frames.frame();
    expect(ticks).toEqual([2_000, 1_500]);
  });
});

describe('formatCountdown', () => {
  it.each([
    [0, '00:00:00.00'],
    [999, '00:00:00.99'],
    [61_234, '00:01:01.23'],
    [3_600_000 + 2 * 60_000 + 3_450, '01:02:03.45'],
    [2 * 86_400_000 + 5_000, '2d 00:00:05.00'],
    [-500, '00:00:00.00'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});
