# Work Breakdown Structure (WBS) — Homework 3

Objective: a Vietnam 11.11 midnight flash-sale storefront. It has a zero-drift millisecond countdown and an
optimistic inventory-lock state machine (reserve → lock with expiry → checkout), and it never oversells under
competing demand. It ships an AI failure audit with at least 3 documented flaws.

> RULE: Never prompt AI with more than one sub-task at a time. One task = one commit.

| # | Task | Verification | Commit |
|---|------|--------------|--------|
| 3.0 | Project rules & WBS | Review | `chore: add project rules and task decomposition` |
| 3.1 | Import the Mini-React engine from Homework 2 | `npm test`, `npm run typecheck` | `chore: import mini-react engine from homework 2` |
| 3.2 | Contracts: products, schedule, sale phase, lock FSM, server API, Clock | `npm run typecheck` | `feat(types): define flash sale contracts` |
| 3.3 | Server clock sync (NTP-style offset) + zero-drift rAF countdown | Unit tests (fake clock, throttled frames) | `feat(time): add server clock sync and zero-drift countdown` |
| 3.4 | Sale phase machine: UPCOMING → LIVE → ENDED | Unit tests | `feat(sale): implement sale phase state machine` |
| 3.5 | Simulated inventory server: TTL locks, idempotent checkout, invariant | Unit tests + stress | `feat(inventory): implement lock-based inventory server` |
| 3.6 | Competing shopper bots | Stress test: no overselling | `feat(inventory): add competing shopper simulation` |
| 3.7 | Optimistic inventory-lock FSM reducer | Unit tests (transition table) | `feat(cart): implement optimistic inventory lock machine` |
| 3.8 | `useReservation` hook: optimistic stock, rollback, expiry timer, stale-response guard | Hook tests | `feat(cart): add race-safe reservation hook` |
| 3.9 | Storefront UI: countdown banner, product cards, checkout panel, demo controls | Checkpoint tests + Chrome | `feat(ui): assemble flash sale storefront` |
| 3.10 | `AI_FAILURE_AUDIT.md` (≥ 3 flaws with proof and fixes) | Review | `docs: add ai failure audit` |
| 3.11 | README with architecture, drift and overselling evidence | Chrome + Lighthouse | `docs: add readme with drift and concurrency evidence` |

## Checklist

- [x] Task 3.0: Write `project-rules.md` and `TASK_DECOMPOSITION.md`
- [x] Task 3.1: Import engine from Homework 2
- [x] Task 3.2: Define flash sale contracts
- [x] Task 3.3: Server clock sync + zero-drift countdown
- [x] Task 3.4: Sale phase machine
- [x] Task 3.5: Lock-based inventory server
- [x] Task 3.6: Competing shopper bots
- [x] Task 3.7: Optimistic inventory lock FSM
- [x] Task 3.8: Reservation hook
- [x] Task 3.9: Storefront UI
- [x] Task 3.10: AI failure audit
- [x] Task 3.11: README
