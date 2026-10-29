import { useEffect, useRef, useState } from '../mini-react';
import { IDLE_LOCK, lockTransition, pendingUnits } from './lock-machine';
import type { Clock, FlashSaleApi, LockEvent, LockState, StockSnapshot } from './types';

export interface ReservationsOptions {
  readonly api: FlashSaleApi;
  readonly customerId: string;
  /** Server-synchronised clock (lock expiries are in server time). */
  readonly clock: Clock;
}

export interface Reservations {
  readonly stock: ReadonlyMap<string, StockSnapshot>;
  readonly locks: ReadonlyMap<string, LockState>;
  lockOf(productId: string): LockState;
  /** Server availability minus this client's optimistic, not-yet-confirmed hold. */
  displayedAvailable(productId: string): number;
  reserve(productId: string): void;
  checkout(productId: string): void;
  release(productId: string): void;
  retry(productId: string): void;
}

const toMap = (stock: readonly StockSnapshot[]): ReadonlyMap<string, StockSnapshot> => new Map(stock.map((s) => [s.productId, s]));

export function useReservations({ api, customerId, clock }: ReservationsOptions): Reservations {
  const [stock, setStock] = useState<ReadonlyMap<string, StockSnapshot>>(toMap(api.stock()));
  const [locks, setLocks] = useState<ReadonlyMap<string, LockState>>(new Map());
  const requestIds = useRef(new Map<string, number>());
  const nextRequest = useRef(0);
  // Mirror of `locks` readable from async callbacks without stale closures.
  const latest = useRef<ReadonlyMap<string, LockState>>(locks);
  latest.current = locks;

  useEffect(() => {
    setStock(toMap(api.stock()));
    return api.subscribe((next) => setStock(toMap(next)));
  }, []);

  const lockOf = (productId: string): LockState => locks.get(productId) ?? IDLE_LOCK;

  const dispatch = (productId: string, event: LockEvent): void =>
    setLocks((previous) => {
      const current = previous.get(productId) ?? IDLE_LOCK;
      const next = lockTransition(current, event);
      if (next === current) return previous; // ignored event: no re-render
      const map = new Map(previous);
      map.set(productId, next);
      return map;
    });

  // Client-side expiry: one timeout per held lock, at its (server-time) deadline.
  const deadlines = [...locks.entries()]
    .flatMap(([productId, lock]) => (lock.status === 'RESERVED' ? [`${productId}:${lock.lockId}:${lock.expiresAt}`] : []))
    .join('|');
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const [productId, lock] of latest.current) {
      if (lock.status !== 'RESERVED') continue;
      const { lockId } = lock;
      const delay = Math.max(0, lock.expiresAt - clock.now());
      timers.push(setTimeout(() => dispatch(productId, { type: 'EXPIRE', lockId, source: 'timer' }), delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [deadlines]);

  const reserve = (productId: string): void => {
    const status = lockOf(productId).status;
    if (status !== 'IDLE' && status !== 'SOLD_OUT' && status !== 'EXPIRED' && status !== 'FAILED') return;
    const requestId = ++nextRequest.current;
    requestIds.current.set(productId, requestId);
    dispatch(productId, { type: 'RESERVE', requestId });

    api.reserve({ productId, quantity: 1, customerId }).then(
      (result) => {
        const stillWanted = requestIds.current.get(productId) === requestId && latest.current.get(productId)?.status === 'RESERVING';
        if (result.ok && !stillWanted) {
          // The user cancelled (or retried) while this was in flight, but the server said yes:
          // give the units back now instead of keeping them locked away until the TTL runs out.
          void api.release(result.lockId);
          return;
        }
        if (result.ok) dispatch(productId, { type: 'RESERVE_OK', requestId, lockId: result.lockId, expiresAt: result.expiresAt });
        else dispatch(productId, { type: 'RESERVE_REJECTED', requestId, reason: result.reason });
      },
      () => dispatch(productId, { type: 'RESERVE_REJECTED', requestId, reason: 'NETWORK' }),
    );
  };

  const checkout = (productId: string): void => {
    const lock = lockOf(productId);
    if (lock.status !== 'RESERVED') return;
    const { lockId } = lock;
    // One key per lock: retries and double submits can never create a second order.
    const idempotencyKey = `${customerId}:${lockId}`;
    dispatch(productId, { type: 'CHECKOUT', idempotencyKey });
    api.checkout({ lockId, customerId, idempotencyKey }).then(
      (result) => {
        if (result.ok) dispatch(productId, { type: 'PAID', lockId, orderId: result.orderId, total: result.total });
        else if (result.reason === 'PAYMENT_DECLINED') dispatch(productId, { type: 'DECLINED', lockId });
        else dispatch(productId, { type: 'EXPIRE', lockId, source: 'server' });
      },
      () => dispatch(productId, { type: 'DECLINED', lockId }),
    );
  };

  const release = (productId: string): void => {
    const lock = lockOf(productId);
    if (lock.status === 'RESERVED') void api.release(lock.lockId);
    if (lock.status === 'RESERVING') requestIds.current.delete(productId); // a late success will be released
    dispatch(productId, { type: 'RELEASE' });
  };

  const retry = (productId: string): void => dispatch(productId, { type: 'RETRY' });

  const displayedAvailable = (productId: string): number =>
    Math.max(0, (stock.get(productId)?.available ?? 0) - pendingUnits(lockOf(productId)));

  return { stock, locks, lockOf, displayedAvailable, reserve, checkout, release, retry };
}
