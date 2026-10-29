import type { FlashSaleApi, Product } from './types';

/** Deterministic PRNG (mulberry32), so simulations are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BotStats {
  readonly attempts: number;
  readonly reserved: number;
  readonly purchased: number;
  readonly abandoned: number;
  readonly rejected: number;
}

export interface BotOptions {
  readonly api: FlashSaleApi;
  readonly products: readonly Product[];
  readonly isLive: () => boolean;
  readonly random?: () => number;
  /** Delay between two shopper arrivals, [min, max] ms. */
  readonly arrivalMs?: readonly [number, number];
  /** Probability that a shopper who got a lock pays for it (the rest abandon and let it expire). */
  readonly checkoutProbability?: number;
  readonly thinkTimeMs?: readonly [number, number];
}

/**
 * Simulated competing demand. Bigger discounts draw more shoppers. Every timer is tracked
 * so stop() leaves nothing running.
 */
export function startShopperBots(options: BotOptions): { stop(): void; stats(): BotStats } {
  const random = options.random ?? seededRandom(1111);
  const [arriveMin, arriveMax] = options.arrivalMs ?? [150, 600];
  const [thinkMin, thinkMax] = options.thinkTimeMs ?? [800, 3000];
  const payRate = options.checkoutProbability ?? 0.7;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stats = { attempts: 0, reserved: 0, purchased: 0, abandoned: 0, rejected: 0 };
  let stopped = false;
  let shopper = 0;

  const between = (min: number, max: number): number => min + random() * (max - min);
  const weights = options.products.map((p) => 1 + (p.originalPrice - p.salePrice) / p.originalPrice * 4);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pickProduct = (): Product | undefined => {
    let roll = random() * totalWeight;
    for (let i = 0; i < options.products.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll <= 0) return options.products[i];
    }
    return options.products.at(-1);
  };

  const later = (ms: number, run: () => void): void => {
    if (stopped) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) run();
    }, ms);
    timers.add(timer);
  };

  const arrive = (): void => {
    later(between(arriveMin, arriveMax), arrive);
    if (!options.isLive()) return;
    const product = pickProduct();
    if (product === undefined) return;
    const customerId = `bot-${++shopper}`;
    stats.attempts++;
    void options.api.reserve({ productId: product.id, quantity: 1, customerId }).then((result) => {
      if (stopped) return;
      if (!result.ok) {
        stats.rejected++;
        return;
      }
      stats.reserved++;
      if (random() >= payRate) {
        stats.abandoned++; // walks away: the lock expires and the unit returns to stock
        return;
      }
      later(between(thinkMin, thinkMax), () => {
        void options.api.checkout({ lockId: result.lockId, customerId, idempotencyKey: `${customerId}-pay` }).then((order) => {
          if (order.ok) stats.purchased++;
        });
      });
    });
  };

  later(between(arriveMin, arriveMax), arrive);

  return {
    stop: () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
    stats: () => ({ ...stats }),
  };
}
