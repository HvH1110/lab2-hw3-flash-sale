import { auditMount, renderApp, type AppHandle } from '../src/mini-react';
import { PRODUCTS } from '../src/products';
import { FlashSaleServer } from '../src/sale/server';
import type { SaleSchedule } from '../src/sale/types';
import { createStorefront } from '../src/storefront';
import { fakeClock, manualFrames } from './sale-fixtures';

let app: AppHandle | null = null;

function mount(options: { decline?: boolean } = {}) {
  const time = fakeClock(1_000_000);
  const frames = manualFrames();
  let schedule: SaleSchedule = { startsAt: time.now + 10_000, endsAt: time.now + 70_000 };
  const parked: (() => void)[] = [];
  const server = new FlashSaleServer({
    products: PRODUCTS,
    schedule: () => schedule,
    clock: time.clock,
    lockTtlMs: 30_000,
    sleep: () => new Promise((resolve) => parked.push(resolve)),
    approvePayment: () => !options.decline,
  });
  const root = document.createElement('section');
  document.body.replaceChildren(root);
  let commits = 0;
  let parityFailures = 0;
  app = renderApp(createStorefront({
    api: server,
    products: PRODUCTS,
    clock: time.clock,
    schedule: () => schedule,
    customerId: 'me',
    scheduler: frames.scheduler,
    sync: { offset: 2_750, roundTrip: 24 },
    simulation: {
      startNow: () => { schedule = { startsAt: time.now, endsAt: time.now + 60_000 }; },
      setLatency: () => {},
      setDeclines: () => {},
      setBots: () => {},
      botStats: () => ({ attempts: 0, purchased: 0 }),
    },
  }), root, {
    onCommit: (tree, container) => {
      commits++;
      if (!auditMount(tree, container).ok) parityFailures++;
    },
  });
  const network = async (): Promise<void> => {
    while (parked.length > 0) parked.shift()?.();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const elapse = (ms: number): void => {
    time.advance(ms);
    frames.frame();
  };
  return { time, frames, server, root, network, elapse, commits: () => commits, parity: () => parityFailures };
}

afterEach(() => {
  app?.unmount();
  app = null;
});

const $ = <E extends Element = HTMLElement>(selector: string): E => {
  const el = document.body.querySelector<E>(selector);
  if (el === null) throw new Error(`not found: ${selector}`);
  return el;
};
const countdown = (): string | null => $('#countdown').textContent;
const card = (id: string): HTMLElement => $(`article[aria-labelledby="name-${id}"]`);

describe('Homework 3 checkpoint: storefront', () => {
  it('shows a centisecond countdown to the start and a disabled Reserve button', () => {
    mount();
    expect($('#phase-label').textContent).toBe('Starts in');
    expect(countdown()).toBe('00:00:10.00');
    expect($('#reserve-phone-x5').getAttribute('aria-disabled')).toBe('true');
    expect($('#reserve-phone-x5').textContent).toBe('Not started');
  });

  it('the countdown is derived from the clock: frame gaps never accumulate error', () => {
    const s = mount();
    for (const gap of [16, 16, 900, 16, 33, 4_000]) s.elapse(gap);
    expect(countdown()).toBe(`00:00:0${(10_000 - 4_981) / 1000}`.replace(/(\.\d{2})\d*$/, '$1').replace('00:00:05.019', '00:00:05.01'));
  });

  it('only re-renders when the visible centisecond changes', () => {
    const s = mount();
    const before = s.commits();
    for (let i = 0; i < 5; i++) s.elapse(1); // five frames inside one 10 ms bucket… mostly
    expect(s.commits() - before).toBeLessThanOrEqual(1);
  });

  it('goes LIVE at the start time, announces it, and enables Reserve', () => {
    const s = mount();
    s.elapse(10_000);
    expect($('#phase-label').textContent).toBe('Ends in');
    expect(countdown()).toBe('00:01:00.00');
    expect($('#announcer').textContent).toBe('The flash sale is live!');
    expect($('#reserve-phone-x5').getAttribute('aria-disabled')).toBeNull();
  });

  it('reserve → optimistic stock → hold countdown → pay → order', async () => {
    const s = mount();
    s.elapse(10_000);
    expect($('#available-phone-x5').textContent).toBe('30 left');
    $('#reserve-phone-x5').click();
    expect($('#available-phone-x5').textContent).toBe('29 left'); // before the server answered
    expect(card('phone-x5').getAttribute('data-status')).toBe('RESERVING');

    await s.network();
    expect(card('phone-x5').getAttribute('data-status')).toBe('RESERVED');
    expect($('.hold time').textContent).toBe('00:30');
    s.elapse(12_345);
    expect($('.hold time').textContent).toBe('00:17');

    $('#pay-phone-x5').click();
    $('#pay-phone-x5').click(); // double click while paying
    await s.network();
    expect(card('phone-x5').getAttribute('data-status')).toBe('PURCHASED');
    expect($('.success').textContent).toMatch(/^Order DH\d{6} confirmed: 3\.990\.000/);
    expect(s.server.soldOf('phone-x5')).toBe(1);
    expect($('label[for="sold-phone-x5"]').textContent).toBe('Sold 1 of 30');
  });

  it('a hold that runs out expires and the unit returns', async () => {
    const s = mount();
    s.elapse(10_000);
    $('#reserve-ao-dai').click();
    await s.network();
    s.elapse(29_990);
    expect($('.hold time').textContent).toBe('00:00');
    expect(card('ao-dai').getAttribute('data-status')).toBe('RESERVED'); // 10 ms left
    s.elapse(10); // the frame that reaches the deadline expires it: display and state agree
    expect(card('ao-dai').getAttribute('data-status')).toBe('EXPIRED');
    await s.network(); // the server's sweep returned the unit
    expect($('#available-ao-dai').textContent).toBe('15 left');
  });

  it('a declined payment keeps the hold and explains why', async () => {
    const s = mount({ decline: true });
    s.elapse(10_000);
    $('#reserve-helmet').click();
    await s.network();
    $('#pay-helmet').click();
    await s.network();
    expect(card('helmet').getAttribute('data-status')).toBe('RESERVED');
    expect(card('helmet').querySelector('[role="alert"]')?.textContent).toMatch(/declined/);
  });

  it('"Start the sale now" skips the countdown', () => {
    const s = mount();
    $('#start-now').click();
    s.elapse(16);
    expect($('#phase-label').textContent).toBe('Ends in');
  });

  it('uses semantic markup, lang="vi" product names, labelled meters, and keeps DOM parity', async () => {
    const s = mount();
    s.elapse(10_000);
    $('#reserve-coffee').click();
    await s.network();
    expect(document.body.querySelector('div, span')).toBeNull();
    expect(document.body.querySelectorAll('h3[lang="vi"]')).toHaveLength(PRODUCTS.length);
    for (const meter of document.body.querySelectorAll('meter')) {
      expect(document.body.querySelector(`label[for="${meter.id}"]`)).not.toBeNull();
    }
    expect($('[role="timer"]').getAttribute('aria-live')).toBeNull(); // not a chatty live region
    expect(s.parity()).toBe(0);
  });
});
