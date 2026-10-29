# Project Rules — Lab 02 / Homework 3: High-Concurrency Flash-Sale E-Commerce Engine

These rules are binding for every human or AI contribution to this repository.
A change that violates any rule below must not be committed.

## 1. Workflow (Anti-Monolithic Vibe Coding)

1. **Functional slicing**: work only on tasks listed in `TASK_DECOMPOSITION.md`.
2. **Contract first**: `src/sale/types.ts` is written before the code that uses it.
3. **Atomic generation**: one sub-task per prompt and one sub-task per commit (minimum 8 commits; Conventional Commits).
4. **Independent verification**: unit tests (fake clocks), stress tests, `npm run typecheck`, and real Chrome.
5. **AI failure audit**: every defect found in AI-generated code is recorded in `AI_FAILURE_AUDIT.md` with the prompt,
   the generated code, the risk, how it was detected (test / DevTools / git diff) and the manual fix.
6. Tick the matching checkbox in `TASK_DECOMPOSITION.md` in the same commit that completes the task.

## 2. Git

- `npm run typecheck` **and** `npm test` must pass before every commit (gated).

## 3. Language & Tooling

- TypeScript `strict`; no `any`. ES modules bundled with Vite.
- **BANNED:** `var`, implicit globals, `keypress`, `e.keyCode`, `innerHTML` and friends, inline handlers.
- UI events go through the root delegation hub. Timers and non-DOM listeners are always cleaned up.

## 4. Time (zero drift)

- **BANNED:** counting time by adding up `setInterval` / `setTimeout` ticks. Ticks only *trigger* a re-read.
- Remaining time is always computed as `target − now()`, where `now()` is the **server-synchronised** clock
  (`Date.now() + offset`, with the offset estimated NTP-style from round trips).
- Countdown frames are driven by `requestAnimationFrame`. Throttled or background tabs resync on `visibilitychange`.
  The display updates only when its visible value changes.
- All time-dependent logic takes an injectable `Clock` so tests use fake time.

## 5. Inventory & Concurrency

- **No overselling, ever:** `sold + locked ≤ stock` is an invariant checked after every server operation.
- Reservations are **locks with a TTL**. An expired lock returns its quantity to stock on the next server operation.
- The UI is **optimistic**: reserving decrements the displayed stock immediately and rolls back if the server refuses.
- Each product's purchase flow is a finite state machine (see `src/sale/lock-machine.ts`). Invalid events are ignored
  (the same state object is returned), so double clicks cannot double-submit.
- Checkout is **idempotent**: the same idempotency key always yields the same order.
- Responses are applied only if their request id is still current (stale responses are dropped).

## 6. Domain

- Vietnam 11.11 midnight flash sale simulation. Prices in VND (`Intl.NumberFormat('vi-VN')`).
  Vietnamese product names carry `lang="vi"`.
- No real brand names, logos or trademarks (the store is fictional).

## 7. Accessibility & Semantics

- Zero div-soup: `<main>`, `<header>`, `<section>`, `<article>`, `<ul>`/`<li>`, `<button>`, `<meter>`, `<time>`, `<output>`, `<label>`.
- The countdown is not a live region (it would chatter); phase changes and reservation results are announced via `role="status"`.
- Lighthouse Accessibility and Best Practices: 100.
