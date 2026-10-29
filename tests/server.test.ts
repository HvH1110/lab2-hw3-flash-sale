import { FlashSaleServer } from '../src/sale/server';
import type { CheckoutRequest, Product, StockSnapshot } from '../src/sale/types';
import { fakeClock } from './sale-fixtures';

const product = (id: string, stock: number, limit = 2): Product => ({
  id, name: id, category: 'Test', originalPrice: 200_000, salePrice: 100_000, stock, perCustomerLimit: limit,
});

/** Synchronous-latency server with manual timers. */
function setup(options: { stock?: number; limit?: number; approve?: (r: CheckoutRequest) => boolean } = {}) {
  const time = fakeClock(0);
  const timers: { fn: () => void; at: number }[] = [];
  const server = new FlashSaleServer({
    products: [product('p1', options.stock ?? 3, options.limit ?? 2), product('p2', 10)],
    schedule: () => ({ startsAt: 1_000, endsAt: 100_000 }),
    clock: time.clock,
    lockTtlMs: 30_000,
    sleep: async () => {},
    approvePayment: options.approve ?? (() => true),
    timers: {
      setTimeout: (fn, ms) => { const t = { fn, at: time.now + ms }; timers.push(t); return t; },
      clearTimeout: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    },
  });
  const runTimers = (): void => {
    for (const t of timers.filter((x) => x.at <= time.now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
  };
  time.set(5_000); // sale is live
  return { server, time, timers, runTimers };
}

const stockOf = (server: FlashSaleServer, id = 'p1'): StockSnapshot | undefined => server.stock().find((s) => s.productId === id);

describe('FlashSaleServer: phases', () => {
  it('rejects reservations before the start and after the end', async () => {
    const { server, time } = setup();
    time.set(999);
    expect(await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' })).toEqual({ ok: false, reason: 'NOT_STARTED' });
    time.set(100_000);
    expect(await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' })).toEqual({ ok: false, reason: 'ENDED' });
  });

  it('reports server time', async () => {
    const { server } = setup();
    expect(await server.serverTime()).toBe(5_000);
  });
});

describe('FlashSaleServer: locks', () => {
  it('a reservation locks units with a TTL and reduces availability', async () => {
    const { server } = setup();
    const result = await server.reserve({ productId: 'p1', quantity: 2, customerId: 'a' });
    expect(result).toMatchObject({ ok: true, productId: 'p1', quantity: 2, expiresAt: 35_000 });
    expect(stockOf(server)).toEqual({ productId: 'p1', stock: 3, sold: 0, locked: 2, available: 1 });
  });

  it('refuses when not enough units are available: SOLD_OUT', async () => {
    const { server } = setup({ stock: 1 });
    await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' });
    expect(await server.reserve({ productId: 'p1', quantity: 1, customerId: 'b' })).toEqual({ ok: false, reason: 'SOLD_OUT' });
  });

  it('enforces the per-customer limit across locks and purchases', async () => {
    const { server } = setup({ stock: 10, limit: 2 });
    const first = await server.reserve({ productId: 'p1', quantity: 2, customerId: 'a' });
    if (!first.ok) throw new Error('reserve failed');
    await server.checkout({ lockId: first.lockId, customerId: 'a', idempotencyKey: 'k1' });
    expect(await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' })).toEqual({ ok: false, reason: 'LIMIT_EXCEEDED' });
    expect((await server.reserve({ productId: 'p1', quantity: 1, customerId: 'b' })).ok).toBe(true);
  });

  it('expired locks return their units on the next operation', async () => {
    const { server, time } = setup({ stock: 1 });
    await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' });
    time.advance(30_000);
    expect((await server.reserve({ productId: 'p1', quantity: 1, customerId: 'b' })).ok).toBe(true);
  });

  it('a timer frees expired units even if nobody calls the server (stock is pushed)', async () => {
    const { server, time, runTimers } = setup({ stock: 1 });
    const seen: number[] = [];
    server.subscribe((stock) => seen.push(stock.find((s) => s.productId === 'p1')?.available ?? -1));
    await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' });
    time.advance(30_000);
    runTimers();
    expect(seen).toEqual([0, 1]);
  });

  it('release returns the units immediately', async () => {
    const { server } = setup({ stock: 1 });
    const lock = await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' });
    if (!lock.ok) throw new Error('reserve failed');
    await server.release(lock.lockId);
    expect(stockOf(server)?.available).toBe(1);
  });
});

describe('FlashSaleServer: checkout', () => {
  async function reserved(s: ReturnType<typeof setup>, customerId = 'a') {
    const lock = await s.server.reserve({ productId: 'p1', quantity: 1, customerId });
    if (!lock.ok) throw new Error('reserve failed');
    return lock;
  }

  it('turns the lock into a sale', async () => {
    const s = setup();
    const lock = await reserved(s);
    const order = await s.server.checkout({ lockId: lock.lockId, customerId: 'a', idempotencyKey: 'k' });
    expect(order).toMatchObject({ ok: true, productId: 'p1', quantity: 1, total: 100_000 });
    expect(stockOf(s.server)).toMatchObject({ sold: 1, locked: 0, available: 2 });
  });

  it('is idempotent: the same key returns the same order and charges once', async () => {
    const s = setup();
    const lock = await reserved(s);
    const request = { lockId: lock.lockId, customerId: 'a', idempotencyKey: 'same' };
    const [a, b] = await Promise.all([s.server.checkout(request), s.server.checkout(request)]);
    const c = await s.server.checkout(request);
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(s.server.soldOf('p1')).toBe(1);
  });

  it('reports LOCK_EXPIRED for a lock that timed out, UNKNOWN_LOCK for someone else’s', async () => {
    const s = setup();
    const mine = await reserved(s, 'a');
    expect(await s.server.checkout({ lockId: mine.lockId, customerId: 'intruder', idempotencyKey: 'x' })).toEqual({ ok: false, reason: 'UNKNOWN_LOCK' });
    s.time.advance(30_000);
    expect(await s.server.checkout({ lockId: mine.lockId, customerId: 'a', idempotencyKey: 'y' })).toEqual({ ok: false, reason: 'LOCK_EXPIRED' });
    expect(s.server.soldOf('p1')).toBe(0);
  });

  it('a declined payment keeps the lock so the user can retry', async () => {
    let approve = false;
    const s = setup({ approve: () => approve });
    const lock = await reserved(s);
    expect(await s.server.checkout({ lockId: lock.lockId, customerId: 'a', idempotencyKey: '1' })).toEqual({ ok: false, reason: 'PAYMENT_DECLINED' });
    expect(stockOf(s.server)?.locked).toBe(1);
    approve = true;
    expect((await s.server.checkout({ lockId: lock.lockId, customerId: 'a', idempotencyKey: '2' })).ok).toBe(true);
  });
});

describe('FlashSaleServer: no overselling', () => {
  it('1 000 concurrent reservations for 3 units: exactly 3 succeed', async () => {
    const { server } = setup({ stock: 3, limit: 1 });
    const results = await Promise.all(
      Array.from({ length: 1_000 }, (_, i) => server.reserve({ productId: 'p1', quantity: 1, customerId: `c${i}` })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.reason === 'SOLD_OUT')).toHaveLength(997);
    expect(stockOf(server)).toMatchObject({ locked: 3, available: 0 });
  });

  it('pushes frozen snapshots and dispose stops the sweep timer', async () => {
    const { server, timers } = setup();
    await server.reserve({ productId: 'p1', quantity: 1, customerId: 'a' });
    expect(Object.isFrozen(server.stock())).toBe(true);
    expect(timers).toHaveLength(1);
    server.dispose();
    expect(timers).toHaveLength(0);
  });
});

describe('FlashSaleServer: dispose', () => {
  it('a request in flight during dispose() does not re-arm the sweep timer (no zombie timers)', async () => {
    const { server, timers } = setup();
    const pending = server.reserve({ productId: 'p1', quantity: 1, customerId: 'late' }); // commits after dispose
    server.dispose();
    expect((await pending).ok).toBe(true);
    expect(timers).toHaveLength(0);
  });
});
