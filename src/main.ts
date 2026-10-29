import './styles.css';
import { auditMount, renderApp } from './mini-react';
import { PRODUCTS } from './products';
import { startShopperBots } from './sale/bots';
import { salePhase } from './sale/phase';
import { FlashSaleServer } from './sale/server';
import { createSyncedClock, estimateServerOffset, systemClock } from './sale/time';
import type { Clock, SaleSchedule } from './sale/types';
import { createStorefront, type Latency } from './storefront';

const LATENCY_MS: Readonly<Record<Latency, number>> = { fast: 80, '4g': 400, congested: 1_500 };

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (root === null) throw new Error('Mount target #app not found');

  // The "server": owns the true clock, the inventory and the schedule.
  let latencyMs = LATENCY_MS.fast;
  let declineRate = 0;
  const loadedAt = Date.now();
  let schedule: SaleSchedule = { startsAt: loadedAt + 20_000, endsAt: loadedAt + 20_000 + 5 * 60_000 };
  const server = new FlashSaleServer({
    products: PRODUCTS,
    schedule: () => schedule,
    clock: systemClock,
    lockTtlMs: 45_000,
    latencyMs: () => latencyMs * (0.6 + Math.random() * 0.8),
    approvePayment: () => Math.random() >= declineRate,
  });

  // This device's clock is deliberately 2.75 s slow; NTP-style sync corrects it.
  const deviceClock: Clock = { now: () => Date.now() - 2_750 };
  const sync = await estimateServerOffset(() => server.serverTime(), deviceClock, 5);
  const clock = createSyncedClock(deviceClock, sync.offset);
  latencyMs = LATENCY_MS['4g'];

  const isLive = (): boolean => salePhase(schedule, systemClock.now()).phase === 'LIVE';
  let bots: ReturnType<typeof startShopperBots> | null = startShopperBots({ api: server, products: PRODUCTS, isLive });
  let botTotals = { attempts: 0, purchased: 0 };
  const botStats = (): { attempts: number; purchased: number } => {
    const current = bots?.stats() ?? { attempts: 0, purchased: 0 };
    return { attempts: botTotals.attempts + current.attempts, purchased: botTotals.purchased + current.purchased };
  };

  let commits = 0;
  renderApp(createStorefront({
    api: server,
    products: PRODUCTS,
    clock,
    schedule: () => schedule,
    customerId: crypto.randomUUID(),
    sync,
    simulation: {
      startNow: () => {
        const now = systemClock.now();
        schedule = { startsAt: now, endsAt: now + 5 * 60_000 };
      },
      setLatency: (latency) => {
        latencyMs = LATENCY_MS[latency];
      },
      setDeclines: (on) => {
        declineRate = on ? 0.4 : 0;
      },
      setBots: (on) => {
        if (on && bots === null) {
          bots = startShopperBots({ api: server, products: PRODUCTS, isLive });
        } else if (!on && bots !== null) {
          botTotals = botStats();
          bots.stop();
          bots = null;
        }
      },
      botStats,
    },
  }), root, {
    onCommit: (tree, container) => {
      commits++;
      if (commits % 300 === 0) {
        const report = auditMount(tree, container);
        console.assert(report.ok, 'VNode/DOM parity audit failed', report.issues);
        console.info(`[commit #${commits}] audit ${report.ok ? 'PASS' : 'FAIL'}: ${report.vnodeCount} VNodes`);
      }
    },
  });
}

void main();
