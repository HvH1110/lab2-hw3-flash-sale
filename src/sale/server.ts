import { salePhase } from './phase';
import type {
  CheckoutRequest,
  CheckoutResult,
  Clock,
  FlashSaleApi,
  Product,
  ReserveRequest,
  ReserveResult,
  SaleSchedule,
  StockSnapshot,
} from './types';

interface Lock {
  readonly id: string;
  readonly productId: string;
  readonly customerId: string;
  readonly quantity: number;
  readonly expiresAt: number;
}

interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ServerOptions {
  readonly products: readonly Product[];
  readonly schedule: () => SaleSchedule;
  /** The server's (true) clock. */
  readonly clock: Clock;
  readonly lockTtlMs: number;
  /** Simulated network latency per call. */
  readonly latencyMs?: () => number;
  /** Payment gateway decision: true approves. */
  readonly approvePayment?: (request: CheckoutRequest) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timers?: Timers;
}

export class InvariantViolation extends Error {
  override readonly name = 'InvariantViolation';
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * In-memory flash-sale backend. Calls are async (simulated latency); once a call reaches the
 * "server", its check-and-update runs synchronously, i.e. atomically, like a DB transaction.
 */
export class FlashSaleServer implements FlashSaleApi {
  private readonly products: ReadonlyMap<string, Product>;
  private readonly sold = new Map<string, number>();
  private readonly locks = new Map<string, Lock>();
  private readonly expiredLocks = new Set<string>();
  /** Idempotency: successful orders by key. */
  private readonly orders = new Map<string, Extract<CheckoutResult, { ok: true }>>();
  /** Units bought per customer+product, for the per-customer limit. */
  private readonly bought = new Map<string, number>();
  private readonly listeners = new Set<(stock: readonly StockSnapshot[]) => void>();
  private readonly options: ServerOptions;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timers: Timers;
  private sweepTimer: unknown = null;
  private disposed = false;
  private sequence = 0;
  private snapshot: readonly StockSnapshot[];

  constructor(options: ServerOptions) {
    this.options = options;
    this.products = new Map(options.products.map((p) => [p.id, p]));
    this.sleep = options.sleep ?? defaultSleep;
    this.timers = options.timers ?? defaultTimers;
    this.snapshot = this.buildSnapshot();
  }

  // ---- API -----------------------------------------------------------------

  async serverTime(): Promise<number> {
    await this.network();
    return this.options.clock.now();
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    await this.network();
    return this.reserveNow(request);
  }

  async checkout(request: CheckoutRequest): Promise<CheckoutResult> {
    await this.network();
    return this.checkoutNow(request);
  }

  async release(lockId: string): Promise<void> {
    await this.network();
    if (this.locks.delete(lockId)) this.commit();
  }

  stock(): readonly StockSnapshot[] {
    return this.snapshot;
  }

  subscribe(listener: (stock: readonly StockSnapshot[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Units bought so far (for tests and the stress audit). */
  soldOf(productId: string): number {
    return this.sold.get(productId) ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    this.listeners.clear();
  }

  // ---- atomic sections ----------------------------------------------------------

  reserveNow({ productId, quantity, customerId }: ReserveRequest): ReserveResult {
    this.sweep();
    const product = this.products.get(productId);
    if (product === undefined || quantity < 1 || !Number.isInteger(quantity)) return { ok: false, reason: 'SOLD_OUT' };

    const { phase } = salePhase(this.options.schedule(), this.options.clock.now());
    if (phase === 'UPCOMING') return { ok: false, reason: 'NOT_STARTED' };
    if (phase === 'ENDED') return { ok: false, reason: 'ENDED' };

    if (this.heldBy(customerId, productId) + quantity > product.perCustomerLimit) return { ok: false, reason: 'LIMIT_EXCEEDED' };
    if (this.available(productId) < quantity) return { ok: false, reason: 'SOLD_OUT' };

    const lock: Lock = {
      id: `L${++this.sequence}`,
      productId,
      customerId,
      quantity,
      expiresAt: this.options.clock.now() + this.options.lockTtlMs,
    };
    this.locks.set(lock.id, lock);
    this.commit();
    return { ok: true, lockId: lock.id, productId, quantity, expiresAt: lock.expiresAt };
  }

  checkoutNow(request: CheckoutRequest): CheckoutResult {
    const previous = this.orders.get(request.idempotencyKey);
    if (previous !== undefined) return previous; // same key → same order, nothing charged twice

    this.sweep();
    const lock = this.locks.get(request.lockId);
    if (lock === undefined || lock.customerId !== request.customerId) {
      return { ok: false, reason: this.expiredLocks.has(request.lockId) ? 'LOCK_EXPIRED' : 'UNKNOWN_LOCK' };
    }
    if (!(this.options.approvePayment?.(request) ?? true)) {
      return { ok: false, reason: 'PAYMENT_DECLINED' }; // the lock is kept: the user may retry before it expires
    }

    const product = this.products.get(lock.productId);
    this.locks.delete(lock.id);
    this.sold.set(lock.productId, (this.sold.get(lock.productId) ?? 0) + lock.quantity);
    const key = `${lock.customerId}|${lock.productId}`;
    this.bought.set(key, (this.bought.get(key) ?? 0) + lock.quantity);
    const order = {
      ok: true as const,
      orderId: `DH${String(++this.sequence).padStart(6, '0')}`,
      productId: lock.productId,
      quantity: lock.quantity,
      total: (product?.salePrice ?? 0) * lock.quantity,
    };
    this.orders.set(request.idempotencyKey, order);
    this.commit();
    return order;
  }

  // ---- internals --------------------------------------------------------------

  private async network(): Promise<void> {
    const ms = this.options.latencyMs?.() ?? 0;
    await this.sleep(ms);
  }

  private locked(productId: string): number {
    let total = 0;
    for (const lock of this.locks.values()) if (lock.productId === productId) total += lock.quantity;
    return total;
  }

  private available(productId: string): number {
    const product = this.products.get(productId);
    if (product === undefined) return 0;
    return product.stock - (this.sold.get(productId) ?? 0) - this.locked(productId);
  }

  private heldBy(customerId: string, productId: string): number {
    let held = this.bought.get(`${customerId}|${productId}`) ?? 0;
    for (const lock of this.locks.values()) if (lock.customerId === customerId && lock.productId === productId) held += lock.quantity;
    return held;
  }

  /** Expired locks give their units back to stock. */
  private sweep(): void {
    const now = this.options.clock.now();
    let changed = false;
    for (const lock of [...this.locks.values()]) {
      if (lock.expiresAt <= now) {
        this.locks.delete(lock.id);
        this.expiredLocks.add(lock.id);
        changed = true;
      }
    }
    if (changed) this.commit();
  }

  /** Re-arms a single timer at the earliest lock expiry so stock reappears without any request. */
  private scheduleSweep(): void {
    if (this.sweepTimer !== null) this.timers.clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    // A request that was in flight during dispose() still commits; it must not re-arm a zombie timer.
    if (this.disposed) return;
    let earliest = Infinity;
    for (const lock of this.locks.values()) earliest = Math.min(earliest, lock.expiresAt);
    if (earliest === Infinity) return;
    const delay = Math.max(0, earliest - this.options.clock.now());
    this.sweepTimer = this.timers.setTimeout(() => {
      this.sweepTimer = null;
      this.sweep();
      this.scheduleSweep();
    }, delay);
  }

  private assertInvariant(): void {
    for (const product of this.products.values()) {
      const sold = this.sold.get(product.id) ?? 0;
      const locked = this.locked(product.id);
      if (sold < 0 || locked < 0 || sold + locked > product.stock) {
        throw new InvariantViolation(`Oversold ${product.id}: sold ${sold} + locked ${locked} > stock ${product.stock}`);
      }
    }
  }

  private commit(): void {
    this.assertInvariant();
    this.scheduleSweep();
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private buildSnapshot(): readonly StockSnapshot[] {
    return Object.freeze([...this.products.values()].map((product) => {
      const sold = this.sold.get(product.id) ?? 0;
      const locked = this.locked(product.id);
      return Object.freeze({ productId: product.id, stock: product.stock, sold, locked, available: product.stock - sold - locked });
    }));
  }
}
