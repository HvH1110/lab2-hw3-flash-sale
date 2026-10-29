# AI Failure Audit — Homework 3: Flash-Sale Engine

Every entry below is a defect that was **actually present in AI-generated code** (written by an AI coding
assistant, Claude) while building this homework or the engine it runs on. Each was caught by an
independent verification step before the code shipped. Entries list the sub-task prompt, the generated code
(quoted from git history), the risk, how it was detected (with proof) and the manual refactor.

The last section is a **controlled baseline experiment**, not a draft from this project: the naive countdown
that the assignment warns about, measured side by side with the shipped one in real Chrome.

| # | Flaw | Class | Detected by | Fix |
|---|------|-------|-------------|-----|
| 1 | `useEffect` recorded deps *after* running the effect, so an effect that sets state looped forever | Infinite render loop | Vitest: `RangeError: Maximum call stack size exceeded` + stack trace | `272a5b9` |
| 2 | `renderApp` stayed "mounted" after a failed first render | Stuck global state | Vitest cascade: every later test failed `already mounted` | `272a5b9` |
| 3 | Inventory server re-armed its sweep timer after `dispose()` | Timer leak (zombie timer) | `vi.getTimerCount()` assertion (`expected 1 to be 0`) | `cd7725f` |
| 4 | Hold expiry driven by a separate `setTimeout`, a second time source | Inconsistent UI state; drift in throttled tabs | Storefront checkpoint test | `9b33327` |
| 5 | A reservation that succeeded after the user cancelled kept the unit locked | Race condition / inventory leak | Design review of the async flow → RACE test | `31dff1e` |
| 6 | A client timer could abandon a checkout the server was about to accept | Race condition / lost sale | Review of the state-machine contract (git diff) | `27dc92d` |
| 7 | An AI-written stress test reused absolute time across runs | Invalid test (false failure) | Debugging the failure with state dumps | `cd7725f` |

---

## Flaw 1 — Effect deps recorded after the effect ran (infinite render loop)

- **Prompt (sub-task 1.3 of HW1, re-used here):** "Add a `useEffect` hook with post-commit flush, dependency
  comparison with `Object.is`, and cleanup."
- **AI-generated code** (`src/use-effect.ts`, as imported in `d23a782`):
  ```ts
  run: () => {
    record.cleanup?.();
    const cleanup = effect();          // ← may call setState, which renders synchronously…
    record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    record.deps = deps;                // ← …but the nested render still sees the OLD deps
  },
  ```
- **Risk:** any effect that sets state with a new value (e.g. `setStock(toMap(api.stock()))`) runs, the nested
  render sees `deps` as "changed", queues the effect again, and the cycle repeats until the stack overflows.
  In HW1/HW2 it stayed hidden because those effects happened to set `Object.is`-equal values, so the effect
  ran twice instead of forever.
- **Detection:** Vitest while writing the reservation-hook tests:
  ```
  RangeError: Maximum call stack size exceeded
   ❯ src/sale/use-reservations.ts:36:5   setState
   ❯ src/use-effect.ts:50:23             Object.run
   ❯ src/use-effect.ts:63:50             flushEffects
   ❯ src/reactive-engine.ts:75:5         Object.render
   ❯ … (repeats)
  ```
- **Engineering refactor:** record the deps (and clear the old cleanup) *before* invoking the effect.
  ```ts
  run: () => {
    record.cleanup?.();
    record.cleanup = undefined;
    record.deps = deps;                // nested renders now see the current deps
    const cleanup = effect();
    record.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
  },
  ```
  Regression test: *"an effect that sets a new value on mount runs exactly once"*. It fails on the old code and passes on the new.

## Flaw 2 — `renderApp` left its "mounted" flag set after a failed first render

- **Prompt (sub-task 2.6 of Exercise 2):** "Implement `renderApp`: reset cursor, render, mount, commit; only one app at a time."
- **AI-generated code:**
  ```ts
  if (mounted) throw new Error('renderApp: an app is already mounted; unmount it first');
  mounted = true;
  …
  setRenderer(render);
  render();                            // ← throws → `mounted` stays true forever
  ```
- **Risk:** one failed mount (bad data, a component bug) bricks the engine for the rest of the page's life.
  Every later `renderApp` throws, and the real error is buried under a cascade of unrelated ones.
- **Detection:** after Flaw 1 threw inside the first render, **9 of 10** hook tests failed with
  `Error: renderApp: an app is already mounted; unmount it first`, even though they were unrelated.
- **Engineering refactor:** wrap the first render; on failure uninstall the renderer, tear down the event hub,
  reset the store and clear the flag before rethrowing. Regression test: *"does not leave the engine locked as
  'already mounted'"*.

## Flaw 3 — Zombie sweep timer after `dispose()`

- **Prompt (sub-task 3.5):** "Simulated inventory server: TTL locks, idempotent checkout, invariant; expired
  locks must return stock even without traffic."
- **AI-generated code** (`src/sale/server.ts`, `0664496`):
  ```ts
  private scheduleSweep(): void {
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    let earliest = Infinity;
    for (const lock of this.locks.values()) earliest = Math.min(earliest, lock.expiresAt);
    …
    this.sweepTimer = this.timers.setTimeout(() => { … }, delay);   // ← also after dispose()
  }
  ```
- **Risk:** a reservation that is in flight (inside its simulated network latency) when the app tears the
  server down still commits, and `commit()` re-arms the sweep timer. The disposed server keeps itself alive
  and fires callbacks after unmount: a memory and CPU leak, and a classic AI omission ("dispose clears the
  timer" without considering work that is already in flight).
- **Detection:** the bots test *"stop() clears every pending timer"* asserted `vi.getTimerCount() === 0`:
  `AssertionError: expected 1 to be +0`.
- **Engineering refactor:** a `disposed` flag; `scheduleSweep()` returns early once disposed. Regression test:
  *"a request in flight during dispose() does not re-arm the sweep timer"*. It fails on the old code, passes on the new.

## Flaw 4 — Hold expiry on a second, independent time source

- **Prompt (sub-task 3.8):** "`useReservation` hook: optimistic stock, rollback, expiry timer, stale-response guard."
- **AI-generated code** (first draft of `src/sale/use-reservations.ts`):
  ```ts
  useEffect(() => {
    const timers = [];
    for (const [productId, lock] of latest.current) {
      if (lock.status !== 'RESERVED') continue;
      const delay = Math.max(0, lock.expiresAt - clock.now());
      timers.push(setTimeout(() => dispatch(productId, { type: 'EXPIRE', … }), delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [deadlines]);
  ```
- **Risk:** the hold countdown the user *sees* comes from the frame-driven synced clock, but the *state*
  changes on an unrelated `setTimeout`. The two disagree: "Held for you: 00:00" while the hold is still active.
  The gap grows in background tabs, where Chrome may delay timers by up to a minute; rAF instead recomputes
  from the clock on the first frame back. This breaks the project rule "ticks only trigger a re-read; never count time with timers".
- **Detection:** the storefront checkpoint test advanced the synced clock past the deadline. The card stayed
  `RESERVED` (`AssertionError: expected 'RESERVED' to be 'EXPIRED'`), because expiry waited for a real-time timer
  that had nothing to do with the clock the UI displays.
- **Engineering refactor:** no timer. The hook receives the app's `now` (one zero-drift ticker) and expires a hold
  in an effect when `now >= expiresAt`, then releases the lock so the unit is back on sale at once:
  ```ts
  useEffect(() => {
    for (const [productId, lock] of locks) {
      if (lock.status === 'RESERVED' && now >= lock.expiresAt) {
        dispatch(productId, { type: 'EXPIRE', lockId: lock.lockId, source: 'timer' });
        void api.release(lock.lockId);
      }
    }
  }, [now, locks]);
  ```
  New tests: expiry happens on the exact frame that reaches the deadline (display and state agree), and a
  long-throttled tab expires the hold on its first frame back.

## Flaw 5 — A late reservation success after "Cancel" kept the unit locked

- **Prompt (sub-task 3.8):** as above.
- **What the naive flow does:** `reserve()` sends the request; the user presses **Cancel** (state → `IDLE`); the
  server then answers **OK**. The reducer correctly ignores the stale `RESERVE_OK`, but nothing tells the server.
  The unit stays locked for the full TTL (45 s), unsellable to anyone during a flash sale.
- **Detection:** a review of the async flow against rule 5 ("responses are applied only if their request id is
  still current"), which asks *what happens to the server side* of a dropped response. It was turned into a RACE test.
- **Engineering refactor:** when a successful response is no longer wanted, release its lock immediately:
  ```ts
  if (result.ok && !stillWanted) {
    void api.release(result.lockId);   // give the unit back now, not after the TTL
    return;
  }
  ```
  Test: *"RACE: cancelling during an in-flight reservation releases the late lock instead of leaking it"*
  (server ends with `locked: 0, available: 2`).

## Flaw 6 — A client timer could abandon an in-flight checkout

- **Prompt (sub-task 3.2 / 3.7):** "Define the lock FSM contracts" → "implement the optimistic lock reducer".
- **AI-generated contract** (`87738ff`): `{ type: 'EXPIRE'; lockId: string }`. With it, the reducer has to treat
  every expiry the same, including during `CHECKING_OUT`.
- **Risk:** the client clock is synchronised only to ±RTT/2 (±31 ms in the Chrome run). A client tick landing
  during payment would show "hold expired" for a payment the server accepts a few ms later. The user is charged
  but the UI says they lost the item.
- **Detection:** review of the transition table while writing the reducer; visible in the `git diff` of `src/sale/types.ts`.
- **Engineering refactor:** the event carries its source, and while paying only the server may expire the lock:
  ```ts
  | { type: 'EXPIRE'; lockId: string; source: 'timer' | 'server' }
  // reducer
  if (state.status === 'CHECKING_OUT' && state.lockId === event.lockId && event.source === 'server') return EXPIRED;
  ```
  Test: *"client timer firing during checkout"* is a no-op (same object returned).

## Flaw 7 — An AI-written stress test that reused absolute time

- **Prompt (sub-task 3.6):** "Stress test: thousands of competing shoppers over a 5-minute sale; prove no overselling."
- **AI-generated test:**
  ```ts
  for (const seed of [1, 2, 3]) {
    const { bots, server } = world(seed);       // schedule is absolute: starts at t = 10 s
    await vi.advanceTimersByTimeAsync(320_000); // …but time is never reset between seeds
  ```
- **Risk:** seeds 2 and 3 start at t = 320 s, after the sale has ended. The test failed
  (`expected 0 to be greater than 2000`), which looks like a product bug. The opposite failure is worse: a test
  that passes because it exercises nothing. **AI-generated tests need verification too.**
- **Detection:** dumping `{ seed, stats, now, timers }` from inside the test. The first seed alone had 4 317
  attempts; later seeds started after `endsAt`.
- **Engineering refactor:** `vi.setSystemTime(0)` at the start of each run, plus an assertion that the run really
  produced traffic (`attempts > 2000`, `rejected > 0`), so an empty run can never pass silently.

---

## Baseline experiment — naive `setInterval` countdown vs. the shipped zero-drift countdown

The assignment names this failure mode explicitly, so it is measured rather than assumed. The audit harness
([`scripts/browser-audit.mjs`](scripts/browser-audit.mjs)) injects the typical naive implementation next to the
real app:

```js
setInterval(() => { remaining -= 10; }, 10);   // "subtract 10 ms every 10 ms"
```

It then samples both against true `Date.now()` in headless Chrome, through a 700 ms long task and a 3 s
main-thread stall (standing in for a throttled background tab):

| Moment | Shipped countdown error | Naive `setInterval` error |
|--------|------------------------:|--------------------------:|
| start | 0 ms | 0 ms |
| +1 s | −15 ms | +205 ms |
| after 700 ms long task | −8 ms | +902 ms |
| after 3 s stall | −6 ms | +3 924 ms |
| +2 s | −2 ms | **+4 238 ms** |

The shipped countdown's error is bounded by one frame plus the 10 ms display bucket and never accumulates,
because every frame recomputes `target − syncedNow()`. The naive one loses every tick the browser clamps,
delays or skips. It drifts even without any stall (+205 ms in the first second), and after one stall it shows
more than 4 s of sale time that no longer exists. Raw data: [docs/browser-audit.json](docs/browser-audit.json).
