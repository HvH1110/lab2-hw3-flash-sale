import { createElement, useEffect, useRef, useState, type RootComponent, type VNode } from './mini-react';
import { discountPercent, formatVnd } from './products';
import { PHASE_LABEL, salePhase } from './sale/phase';
import { createTicker, formatCountdown } from './sale/time';
import type { Clock, FlashSaleApi, FrameScheduler, LockState, Product, SaleSchedule, StockSnapshot } from './sale/types';
import { useReservations, type Reservations } from './sale/use-reservations';

export type Latency = 'fast' | '4g' | 'congested';

export interface StorefrontDeps {
  readonly api: FlashSaleApi;
  readonly products: readonly Product[];
  /** Server-synchronised clock. */
  readonly clock: Clock;
  readonly schedule: () => SaleSchedule;
  readonly customerId: string;
  readonly scheduler?: FrameScheduler;
  /** Result of the NTP-style sync, for display. */
  readonly sync: { readonly offset: number; readonly roundTrip: number };
  readonly simulation: {
    readonly startNow: () => void;
    readonly setLatency: (latency: Latency) => void;
    readonly setDeclines: (on: boolean) => void;
    readonly setBots: (on: boolean) => void;
    readonly botStats: () => { readonly attempts: number; readonly purchased: number };
  };
}

const mmss = (ms: number): string => formatCountdown(ms).slice(3, 8);

function ActionArea({ product, lock, available, live, now, actions }: {
  readonly product: Product;
  readonly lock: LockState;
  readonly available: number;
  readonly live: boolean;
  readonly now: number;
  readonly actions: Reservations;
}): VNode {
  const id = product.id;
  const button = (key: string, label: string, onClick: () => void, options: { primary?: boolean; disabled?: boolean; ariaLabel?: string } = {}): VNode =>
    createElement('button', {
      key,
      id: `${key}-${id}`,
      type: 'button',
      className: options.primary ? 'btn' : 'btn btn--ghost',
      'aria-disabled': options.disabled ? 'true' : undefined,
      'aria-label': options.ariaLabel,
      onClick: () => {
        if (!options.disabled) onClick();
      },
    }, label);

  switch (lock.status) {
    case 'IDLE':
      return createElement('footer', { className: 'card__actions' },
        button('reserve', live ? (available > 0 ? 'Reserve' : 'Sold out') : 'Not started', () => actions.reserve(id), {
          primary: true, disabled: !live || available === 0, ariaLabel: `Reserve ${product.name}`,
        }),
        createElement('p', { className: 'hint' }, `Limit ${product.perCustomerLimit} per customer`),
      );
    case 'RESERVING':
      return createElement('footer', { className: 'card__actions', 'aria-busy': 'true' },
        button('reserve', 'Reserving…', () => {}, { primary: true, disabled: true }),
        button('cancel', 'Cancel', () => actions.release(id)),
      );
    case 'RESERVED':
      return createElement('footer', { className: 'card__actions card__actions--held' },
        createElement('p', { className: 'hold' }, 'Held for you: ',
          createElement('time', { dateTime: `PT${Math.max(0, Math.ceil((lock.expiresAt - now) / 1000))}S` }, mmss(lock.expiresAt - now))),
        lock.notice === null ? null : createElement('p', { className: 'notice', role: 'alert' }, lock.notice),
        button('pay', `Pay ${formatVnd(product.salePrice)}`, () => actions.checkout(id), { primary: true }),
        button('release', 'Release', () => actions.release(id)),
      );
    case 'CHECKING_OUT':
      return createElement('footer', { className: 'card__actions', 'aria-busy': 'true' },
        button('pay', 'Processing payment…', () => {}, { primary: true, disabled: true }),
      );
    case 'PURCHASED':
      return createElement('footer', { className: 'card__actions card__actions--done' },
        createElement('p', { className: 'success' }, `Order ${lock.orderId} confirmed: ${formatVnd(lock.total)}`),
      );
    case 'SOLD_OUT':
      return createElement('footer', { className: 'card__actions' },
        createElement('p', { className: 'problem' }, 'Sold out before your hold. Units return when other holds expire.'),
        button('retry', 'Try again', () => actions.reserve(id), { disabled: !live || available === 0 }),
      );
    case 'EXPIRED':
      return createElement('footer', { className: 'card__actions' },
        createElement('p', { className: 'problem' }, 'Your hold expired and the unit went back on sale.'),
        button('retry', 'Reserve again', () => actions.reserve(id), { disabled: !live || available === 0 }),
      );
    case 'FAILED':
      return createElement('footer', { className: 'card__actions' },
        createElement('p', { className: 'problem' }, lock.message),
        button('retry', 'Try again', () => actions.retry(id)),
      );
  }
}

function ProductCard({ product, stock, lock, available, live, now, actions }: {
  readonly product: Product;
  readonly stock: StockSnapshot | undefined;
  readonly lock: LockState;
  readonly available: number;
  readonly live: boolean;
  readonly now: number;
  readonly actions: Reservations;
}): VNode {
  const sold = stock?.sold ?? 0;
  return createElement('li', { key: product.id },
    createElement('article', { className: 'card', 'aria-labelledby': `name-${product.id}`, 'data-status': lock.status },
      createElement('p', { className: 'card__badge' }, `-${discountPercent(product)}%`),
      createElement('h3', { id: `name-${product.id}`, lang: 'vi' }, product.name),
      createElement('p', { className: 'card__category', lang: 'vi' }, product.category),
      createElement('p', { className: 'card__price' },
        createElement('strong', null, formatVnd(product.salePrice)),
        ' ',
        createElement('del', { 'aria-label': `was ${formatVnd(product.originalPrice)}` }, formatVnd(product.originalPrice)),
      ),
      createElement('label', { htmlFor: `sold-${product.id}`, className: 'card__meter-label' }, `Sold ${sold} of ${product.stock}`),
      createElement('meter', { id: `sold-${product.id}`, min: 0, max: product.stock, value: sold, low: product.stock * 0.5, high: product.stock * 0.85, optimum: 0 }),
      createElement('p', { id: `available-${product.id}`, className: 'card__available' }, `${available} left`),
      ActionArea({ product, lock, available, live, now, actions }),
    ),
  );
}

export function createStorefront(deps: StorefrontDeps): RootComponent {
  return function Storefront(): VNode {
    const { clock, products, simulation } = deps;
    const [now, setNow] = useState(clock.now());
    const [latency, setLatency] = useState<Latency>('4g');
    const [declines, setDeclines] = useState(false);
    const [bots, setBots] = useState(true);
    const [announcement, setAnnouncement] = useState('');
    const reservations = useReservations({ api: deps.api, customerId: deps.customerId, now });

    const schedule = deps.schedule();
    const { phase, nextChangeAt } = salePhase(schedule, now);
    const remaining = nextChangeAt === null ? 0 : nextChangeAt - now;
    const holding = [...reservations.locks.values()].some((l) => l.status === 'RESERVED' || l.status === 'CHECKING_OUT');
    // Centiseconds while something is counting down; once a second otherwise (no wasted renders).
    const resolution = phase !== 'ENDED' || holding ? 10 : 1_000;

    // One zero-drift ticker drives every time-derived value (phase, banner, hold timers).
    useEffect(() => createTicker({ clock, resolutionMs: resolution, onTick: setNow, scheduler: deps.scheduler }), [resolution]);

    const lastPhase = useRef(phase);
    useEffect(() => {
      if (lastPhase.current === phase) return;
      lastPhase.current = phase;
      setAnnouncement(phase === 'LIVE' ? 'The flash sale is live!' : phase === 'ENDED' ? 'The flash sale has ended.' : '');
    }, [phase]);

    const live = phase === 'LIVE';
    const inputValue = (event: Event): string =>
      event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target.value : '';
    const stats = simulation.botStats();

    return createElement('main', { className: 'store' },
      createElement('header', { className: `banner banner--${phase.toLowerCase()}` },
        createElement('p', { className: 'banner__eyebrow' }, 'Midnight flash sale · fictional store'),
        createElement('h1', { lang: 'vi' }, 'Siêu Sale 11.11'),
        createElement('p', { className: 'banner__phase', id: 'phase-label' }, PHASE_LABEL[phase]),
        createElement('p', { className: 'banner__countdown', role: 'timer', 'aria-labelledby': 'phase-label' },
          createElement('time', { id: 'countdown', dateTime: `PT${Math.ceil(remaining / 1000)}S` }, phase === 'ENDED' ? '00:00:00.00' : formatCountdown(remaining)),
        ),
      ),

      createElement('section', { className: 'deals', 'aria-labelledby': 'deals-title' },
        createElement('h2', { id: 'deals-title' }, 'Deals'),
        createElement('ul', { className: 'deals__grid' },
          products.map((product) => ProductCard({
            product,
            stock: reservations.stock.get(product.id),
            lock: reservations.lockOf(product.id),
            available: reservations.displayedAvailable(product.id),
            live,
            now,
            actions: reservations,
          })),
        ),
      ),

      createElement('section', { className: 'panel simulation', 'aria-labelledby': 'sim-title' },
        createElement('h2', { id: 'sim-title' }, 'Simulation'),
        createElement('p', { className: 'sim__row' },
          createElement('button', {
            id: 'start-now', type: 'button', className: 'btn', 'aria-disabled': String(phase !== 'UPCOMING'),
            onClick: () => {
              if (phase === 'UPCOMING') simulation.startNow();
            },
          }, 'Start the sale now'),
          createElement('label', { htmlFor: 'latency' }, 'Network'),
          createElement('select', {
            id: 'latency', value: latency,
            onChange: (event: Event) => {
              const next = inputValue(event) as Latency;
              setLatency(next);
              simulation.setLatency(next);
            },
          },
            createElement('option', { key: 'fast', value: 'fast', selected: latency === 'fast' }, 'Fast (≈80 ms)'),
            createElement('option', { key: '4g', value: '4g', selected: latency === '4g' }, '4G (≈400 ms)'),
            createElement('option', { key: 'congested', value: 'congested', selected: latency === 'congested' }, 'Congested 11.11 (≈1.5 s)'),
          ),
        ),
        createElement('p', { className: 'sim__row' },
          createElement('label', { htmlFor: 'bots', className: 'check' },
            createElement('input', { id: 'bots', type: 'checkbox', checked: bots, onChange: () => { setBots(!bots); simulation.setBots(!bots); } }),
            'Competing shoppers',
          ),
          createElement('label', { htmlFor: 'declines', className: 'check' },
            createElement('input', { id: 'declines', type: 'checkbox', checked: declines, onChange: () => { setDeclines(!declines); simulation.setDeclines(!declines); } }),
            'Payment gateway declines 40%',
          ),
        ),
        createElement('dl', { className: 'sim__stats' },
          ([
            ['Clock offset vs server', `${deps.sync.offset >= 0 ? '+' : ''}${Math.round(deps.sync.offset)} ms (±${Math.round(deps.sync.roundTrip / 2)} ms)`],
            ['Competing shoppers', String(stats.attempts)],
            ['Their purchases', String(stats.purchased)],
          ] as const).map(([term, value]) => [
            createElement('dt', { key: `t-${term}` }, term),
            createElement('dd', { key: `d-${term}`, id: `stat-${term.toLowerCase().replace(/\s+/g, '-')}` }, value),
          ]),
        ),
      ),

      createElement('p', { id: 'announcer', className: 'announcer', role: 'status' }, announcement),
    );
  };
}
