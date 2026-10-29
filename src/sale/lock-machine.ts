import type { LockEvent, LockState, ReserveRejection } from './types';

export const IDLE_LOCK: LockState = Object.freeze({ status: 'IDLE' });

const REJECTION_MESSAGES: Readonly<Record<Exclude<ReserveRejection, 'SOLD_OUT'> | 'NETWORK', string>> = {
  NOT_STARTED: 'The sale has not started yet.',
  ENDED: 'The sale has ended.',
  LIMIT_EXCEEDED: 'You have reached the per-customer limit for this item.',
  NETWORK: 'Network problem. Please try again.',
};

const freeze = <S extends LockState>(state: S): S => Object.freeze(state);

/**
 * Optimistic inventory-lock machine for one product.
 *
 *   IDLE ─RESERVE─► RESERVING ─RESERVE_OK─► RESERVED ─CHECKOUT─► CHECKING_OUT ─PAID─► PURCHASED
 *    ▲     (stock shown −1)  │                │  ▲                 │
 *    │                       │                │  └──DECLINED───────┤  (notice, lock kept)
 *    │        RESERVE_REJECTED: SOLD_OUT / FAILED                   │
 *    │                       │      EXPIRE (timer) ─► EXPIRED ◄── EXPIRE (server only)
 *    └──RELEASE / RETRY──────┴──────────────────────────────────────┘
 *
 * Events that do not apply return the *same* object: double clicks and stale responses are no-ops.
 */
export function lockTransition(state: LockState, event: LockEvent): LockState {
  switch (event.type) {
    case 'RESERVE':
      if (state.status === 'IDLE' || state.status === 'SOLD_OUT' || state.status === 'EXPIRED' || state.status === 'FAILED') {
        return freeze({ status: 'RESERVING', requestId: event.requestId });
      }
      return state;

    case 'RESERVE_OK':
      if (state.status !== 'RESERVING' || state.requestId !== event.requestId) return state;
      return freeze({ status: 'RESERVED', lockId: event.lockId, expiresAt: event.expiresAt, notice: null });

    case 'RESERVE_REJECTED':
      if (state.status !== 'RESERVING' || state.requestId !== event.requestId) return state;
      if (event.reason === 'SOLD_OUT') return freeze({ status: 'SOLD_OUT' });
      return freeze({ status: 'FAILED', message: REJECTION_MESSAGES[event.reason] });

    case 'CHECKOUT':
      if (state.status !== 'RESERVED') return state; // a second click while paying does nothing
      return freeze({ status: 'CHECKING_OUT', lockId: state.lockId, expiresAt: state.expiresAt, idempotencyKey: event.idempotencyKey });

    case 'PAID':
      if (state.status !== 'CHECKING_OUT' || state.lockId !== event.lockId) return state;
      return freeze({ status: 'PURCHASED', orderId: event.orderId, total: event.total });

    case 'DECLINED':
      if (state.status !== 'CHECKING_OUT' || state.lockId !== event.lockId) return state;
      return freeze({
        status: 'RESERVED',
        lockId: state.lockId,
        expiresAt: state.expiresAt,
        notice: 'Payment was declined. You can try again while your hold lasts.',
      });

    case 'EXPIRE':
      if (state.status === 'RESERVED' && state.lockId === event.lockId) return freeze({ status: 'EXPIRED' });
      // While paying, only the server may declare the lock expired: the client clock can be a few ms off,
      // and abandoning a payment the server is about to accept would lose a sale the user paid for.
      if (state.status === 'CHECKING_OUT' && state.lockId === event.lockId && event.source === 'server') return freeze({ status: 'EXPIRED' });
      return state;

    case 'RELEASE':
      return state.status === 'RESERVED' || state.status === 'RESERVING' ? IDLE_LOCK : state;

    case 'RETRY':
      return state.status === 'SOLD_OUT' || state.status === 'EXPIRED' || state.status === 'FAILED' ? IDLE_LOCK : state;

    default: {
      const unreachable: never = event;
      throw new Error(`Unhandled event ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Units this client shows as taken before the server has confirmed (optimistic UI). */
export function pendingUnits(state: LockState): number {
  return state.status === 'RESERVING' ? 1 : 0;
}

/** Whether this client currently holds a server lock (counted in the server's `locked`). */
export function holdsLock(state: LockState): boolean {
  return state.status === 'RESERVED' || state.status === 'CHECKING_OUT';
}
