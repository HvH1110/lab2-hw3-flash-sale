import { createElement } from '../src/create-element';
import { renderApp, type AppHandle } from '../src/reactive-engine';
import { FlashSaleServer } from '../src/sale/server';
import type { CheckoutRequest, Product } from '../src/sale/types';
import { useReservations, type Reservations } from '../src/sale/use-reservations';
import type { VNode } from '../src/types';
import { fakeClock } from './sale-fixtures';

const products: readonly Product[] = [
  { id: 'p1', name: 'Áo dài', category: 'Fashion', originalPrice: 800_000, salePrice: 399_000, stock: 2, perCustomerLimit: 1 },
];

/** Network calls park until the test releases them, in any order. */
function controllableNetwork() {
  const parked: (() => void)[] = [];
  return {
    sleep: () => new Promise<void>((resolve) => parked.push(resolve)),
    deliverAll: async () => {
      while (parked.length > 0) parked.shift()?.();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
    get parked() { return parked.length; },
  };
}

let app: AppHandle | null = null;
let r!: Reservations;
let renders = 0;

function mount(options: { approve?: (req: CheckoutRequest) => boolean; ttl?: number } = {}) {
  const time = fakeClock(10_000);
  const net = controllableNetwork();
  const server = new FlashSaleServer({
    products,
    schedule: () => ({ startsAt: 0, endsAt: 1e15 }),
    clock: time.clock,
    lockTtlMs: options.ttl ?? 60_000,
    sleep: net.sleep,
    approvePayment: options.approve ?? (() => true),
  });
  renders = 0;
  function Probe(): VNode {
    renders++;
    r = useReservations({ api: server, customerId: 'me', clock: time.clock });
    return createElement('output', null, r.lockOf('p1').status);
  }
  app = renderApp(Probe, document.createElement('section'));
  return { server, net, time };
}

beforeEach(() => vi.useFakeTimers({ now: 10_000 }));
afterEach(() => {
  app?.unmount();
  app = null;
  vi.useRealTimers();
});

describe('useReservations', () => {
  it('optimistic: the unit disappears immediately, then the lock is confirmed', async () => {
    const { net, server } = mount();
    r.reserve('p1');
    expect(r.lockOf('p1').status).toBe('RESERVING');
    expect(r.displayedAvailable('p1')).toBe(1); // 2 − 1 optimistic, before the server answered
    await net.deliverAll();
    expect(r.lockOf('p1')).toMatchObject({ status: 'RESERVED', expiresAt: 70_000 });
    expect(r.displayedAvailable('p1')).toBe(1); // now counted by the server's lock, not twice
    expect(server.stock()[0]).toMatchObject({ locked: 1, available: 1 });
  });

  it('rolls the optimistic unit back when the server says SOLD_OUT', async () => {
    const { net, server } = mount();
    server.reserveNow({ productId: 'p1', quantity: 1, customerId: 'x' });
    server.reserveNow({ productId: 'p1', quantity: 1, customerId: 'y' });
    r.reserve('p1');
    expect(r.displayedAvailable('p1')).toBe(0);
    await net.deliverAll();
    expect(r.lockOf('p1').status).toBe('SOLD_OUT');
    expect(r.displayedAvailable('p1')).toBe(0);
  });

  it('a double click sends a single reservation', async () => {
    const { net } = mount();
    r.reserve('p1');
    r.reserve('p1');
    expect(net.parked).toBe(1);
  });

  it('checkout turns the lock into an order; double-clicking Pay charges once', async () => {
    const { net, server } = mount();
    r.reserve('p1');
    await net.deliverAll();
    r.checkout('p1');
    r.checkout('p1');
    expect(net.parked).toBe(1);
    await net.deliverAll();
    expect(r.lockOf('p1')).toMatchObject({ status: 'PURCHASED', total: 399_000 });
    expect(server.soldOf('p1')).toBe(1);
  });

  it('a declined payment keeps the hold with a notice, and a retry can still succeed', async () => {
    let approve = false;
    const { net, server } = mount({ approve: () => approve });
    r.reserve('p1');
    await net.deliverAll();
    r.checkout('p1');
    await net.deliverAll();
    expect(r.lockOf('p1')).toMatchObject({ status: 'RESERVED', notice: expect.stringContaining('declined') });
    approve = true;
    r.checkout('p1');
    await net.deliverAll();
    expect(r.lockOf('p1').status).toBe('PURCHASED');
    expect(server.soldOf('p1')).toBe(1);
  });

  it('the client timer expires the hold at its deadline and the unit returns to stock', async () => {
    const { net, time, server } = mount({ ttl: 5_000 });
    r.reserve('p1');
    await net.deliverAll();
    time.advance(4_999);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(r.lockOf('p1').status).toBe('RESERVED');
    time.advance(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.lockOf('p1').status).toBe('EXPIRED');
    expect(server.stock()[0]?.available).toBe(2);
  });

  it('RACE: cancelling during an in-flight reservation releases the late lock instead of leaking it', async () => {
    const { net, server } = mount();
    r.reserve('p1');
    r.release('p1');
    expect(r.lockOf('p1').status).toBe('IDLE');
    await net.deliverAll(); // reserve succeeds on the server, then the hook releases it
    await net.deliverAll(); // the release call lands
    expect(r.lockOf('p1').status).toBe('IDLE');
    expect(server.stock()[0]).toMatchObject({ locked: 0, available: 2 });
  });

  it('release gives a confirmed hold back to the server', async () => {
    const { net, server } = mount();
    r.reserve('p1');
    await net.deliverAll();
    r.release('p1');
    await net.deliverAll();
    expect(server.stock()[0]?.locked).toBe(0);
  });

  it('a network failure becomes a retryable FAILED state', async () => {
    const { net, server } = mount();
    const spy = vi.spyOn(server, 'reserve').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    r.reserve('p1');
    await net.deliverAll();
    expect(r.lockOf('p1')).toMatchObject({ status: 'FAILED', message: 'Network problem. Please try again.' });
    spy.mockRestore();
    r.reserve('p1');
    await net.deliverAll();
    expect(r.lockOf('p1').status).toBe('RESERVED');
  });

  it('ignored events do not re-render', async () => {
    const { net } = mount();
    r.reserve('p1');
    await net.deliverAll();
    const before = renders;
    r.retry('p1'); // not applicable while RESERVED
    expect(renders).toBe(before);
  });
});
