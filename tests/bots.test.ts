import { seededRandom, startShopperBots } from '../src/sale/bots';
import { salePhase } from '../src/sale/phase';
import { FlashSaleServer } from '../src/sale/server';
import { systemClock } from '../src/sale/time';
import type { Product } from '../src/sale/types';

const products: readonly Product[] = [
  { id: 'phone', name: 'Điện thoại', category: 'Tech', originalPrice: 10_000_000, salePrice: 4_990_000, stock: 40, perCustomerLimit: 1 },
  { id: 'rice', name: 'Gạo ST25', category: 'Food', originalPrice: 200_000, salePrice: 150_000, stock: 120, perCustomerLimit: 2 },
  { id: 'helmet', name: 'Mũ bảo hiểm', category: 'Auto', originalPrice: 500_000, salePrice: 99_000, stock: 25, perCustomerLimit: 1 },
];

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function world(seed: number) {
  const random = seededRandom(seed);
  const schedule = { startsAt: 10_000, endsAt: 310_000 };
  const server = new FlashSaleServer({
    products,
    schedule: () => schedule,
    clock: systemClock,
    lockTtlMs: 20_000,
    latencyMs: () => 50 + random() * 400,
    approvePayment: () => random() > 0.1,
  });
  const bots = startShopperBots({
    api: server,
    products,
    random,
    isLive: () => salePhase(schedule, Date.now()).phase === 'LIVE',
    arrivalMs: [20, 120],
  });
  return { server, bots };
}

describe('competing shopper bots', () => {
  it('do nothing before the sale starts', async () => {
    const { bots, server } = world(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(bots.stats().attempts).toBe(0);
    bots.stop();
    server.dispose();
  });

  it('STRESS: a 5-minute sale with thousands of shoppers never oversells and accounts for every unit', async () => {
    for (const seed of [1, 2, 3]) {
      vi.setSystemTime(0); // each run starts before the sale (the schedule is absolute)
      const { bots, server } = world(seed);
      const violations: string[] = [];
      server.subscribe((stock) => {
        for (const s of stock) {
          if (s.sold + s.locked > s.stock || s.available < 0) violations.push(`${s.productId}: ${JSON.stringify(s)}`);
          if (s.sold + s.locked + s.available !== s.stock) violations.push(`${s.productId}: units lost`);
        }
      });

      await vi.advanceTimersByTimeAsync(320_000); // through the whole sale and past the last lock expiry
      const stats = bots.stats();
      expect(violations).toEqual([]);
      expect(stats.attempts).toBeGreaterThan(2_000);
      expect(stats.rejected).toBeGreaterThan(0); // the sale really sold out
      const sold = products.reduce((total, p) => total + server.soldOf(p.id), 0);
      expect(sold).toBe(stats.purchased);
      for (const p of products) expect(server.soldOf(p.id)).toBeLessThanOrEqual(p.stock);
      expect(server.stock().every((s) => s.locked === 0)).toBe(true); // all abandoned locks expired

      bots.stop();
      server.dispose();
    }
  });

  it('stop() clears every pending timer', async () => {
    const { bots, server } = world(4);
    await vi.advanceTimersByTimeAsync(15_000);
    bots.stop();
    server.dispose();
    await vi.runOnlyPendingTimersAsync(); // in-flight latency sleeps settle
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is deterministic for a seed', async () => {
    const run = async (): Promise<number> => {
      const { bots, server } = world(9);
      await vi.advanceTimersByTimeAsync(60_000);
      bots.stop();
      server.dispose();
      return bots.stats().attempts;
    };
    vi.setSystemTime(0);
    const a = await run();
    vi.setSystemTime(0);
    const b = await run();
    expect(a).toBe(b);
  });
});
