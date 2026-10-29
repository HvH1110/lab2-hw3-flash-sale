// Flash-sale contracts (written before any implementation).

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Milliseconds since the epoch. Injected everywhere so tests control time. */
export interface Clock {
  now(): number;
}

/** Injected so tests can run animation frames by hand. */
export interface FrameScheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

// ---------------------------------------------------------------------------
// Catalogue & schedule
// ---------------------------------------------------------------------------

export interface Product {
  readonly id: string;
  /** Vietnamese display name (rendered with lang="vi"). */
  readonly name: string;
  readonly category: string;
  /** VND. */
  readonly originalPrice: number;
  /** VND. */
  readonly salePrice: number;
  /** Units allocated to this flash sale. */
  readonly stock: number;
  readonly perCustomerLimit: number;
}

export interface SaleSchedule {
  readonly startsAt: number;
  readonly endsAt: number;
}

export type SalePhase = 'UPCOMING' | 'LIVE' | 'ENDED';

export interface PhaseInfo {
  readonly phase: SalePhase;
  /** When the phase changes next (null once ENDED). */
  readonly nextChangeAt: number | null;
}

// ---------------------------------------------------------------------------
// Inventory server API (simulated; async like a real backend)
// ---------------------------------------------------------------------------

export interface StockSnapshot {
  readonly productId: string;
  readonly stock: number;
  readonly sold: number;
  /** Units held by unexpired locks. */
  readonly locked: number;
  /** stock − sold − locked. Never negative. */
  readonly available: number;
}

export type ReserveRejection = 'SOLD_OUT' | 'NOT_STARTED' | 'ENDED' | 'LIMIT_EXCEEDED';

export type ReserveResult =
  | { readonly ok: true; readonly lockId: string; readonly productId: string; readonly quantity: number; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: ReserveRejection };

export type CheckoutRejection = 'LOCK_EXPIRED' | 'PAYMENT_DECLINED' | 'UNKNOWN_LOCK';

export type CheckoutResult =
  | { readonly ok: true; readonly orderId: string; readonly productId: string; readonly quantity: number; readonly total: number }
  | { readonly ok: false; readonly reason: CheckoutRejection };

export interface ReserveRequest {
  readonly productId: string;
  readonly quantity: number;
  readonly customerId: string;
}

export interface CheckoutRequest {
  readonly lockId: string;
  readonly customerId: string;
  /** Same key → same order. Protects against double submits and retries. */
  readonly idempotencyKey: string;
}

export interface FlashSaleApi {
  serverTime(): Promise<number>;
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  checkout(request: CheckoutRequest): Promise<CheckoutResult>;
  release(lockId: string): Promise<void>;
  stock(): readonly StockSnapshot[];
  /** Pushes stock after every change (users, bots, expiries). */
  subscribe(listener: (stock: readonly StockSnapshot[]) => void): () => void;
}

// ---------------------------------------------------------------------------
// Per-product purchase flow (optimistic inventory lock machine)
// ---------------------------------------------------------------------------

export type LockState =
  | { readonly status: 'IDLE' }
  /** Optimistic: one unit is already shown as taken while the server decides. */
  | { readonly status: 'RESERVING'; readonly requestId: number }
  | { readonly status: 'RESERVED'; readonly lockId: string; readonly expiresAt: number; readonly notice: string | null }
  | { readonly status: 'CHECKING_OUT'; readonly lockId: string; readonly expiresAt: number; readonly idempotencyKey: string }
  | { readonly status: 'PURCHASED'; readonly orderId: string; readonly total: number }
  | { readonly status: 'SOLD_OUT' }
  | { readonly status: 'EXPIRED' }
  | { readonly status: 'FAILED'; readonly message: string };

export type LockEvent =
  | { readonly type: 'RESERVE'; readonly requestId: number }
  | { readonly type: 'RESERVE_OK'; readonly requestId: number; readonly lockId: string; readonly expiresAt: number }
  | { readonly type: 'RESERVE_REJECTED'; readonly requestId: number; readonly reason: ReserveRejection | 'NETWORK' }
  | { readonly type: 'CHECKOUT'; readonly idempotencyKey: string }
  | { readonly type: 'PAID'; readonly lockId: string; readonly orderId: string; readonly total: number }
  | { readonly type: 'DECLINED'; readonly lockId: string }
  /** `timer`: the client's own countdown reached zero. `server`: checkout answered LOCK_EXPIRED. */
  | { readonly type: 'EXPIRE'; readonly lockId: string; readonly source: 'timer' | 'server' }
  | { readonly type: 'RELEASE' }
  | { readonly type: 'RETRY' };

export type LockStatus = LockState['status'];
