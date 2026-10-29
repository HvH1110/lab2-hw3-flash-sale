import { IDLE_LOCK, holdsLock, lockTransition, pendingUnits } from '../src/sale/lock-machine';
import type { LockEvent, LockState } from '../src/sale/types';

const reserving: LockState = { status: 'RESERVING', requestId: 2 };
const reserved: LockState = { status: 'RESERVED', lockId: 'L1', expiresAt: 9_000, notice: null };
const paying: LockState = { status: 'CHECKING_OUT', lockId: 'L1', expiresAt: 9_000, idempotencyKey: 'k' };
const soldOut: LockState = { status: 'SOLD_OUT' };
const expired: LockState = { status: 'EXPIRED' };
const failed: LockState = { status: 'FAILED', message: 'x' };
const purchased: LockState = { status: 'PURCHASED', orderId: 'DH1', total: 100 };

describe('lockTransition: happy path and branches', () => {
  it.each<[string, LockState, LockEvent, LockState]>([
    ['IDLE + RESERVE → RESERVING', IDLE_LOCK, { type: 'RESERVE', requestId: 2 }, reserving],
    ['RESERVING + RESERVE_OK → RESERVED', reserving, { type: 'RESERVE_OK', requestId: 2, lockId: 'L1', expiresAt: 9_000 }, reserved],
    ['RESERVED + CHECKOUT → CHECKING_OUT', reserved, { type: 'CHECKOUT', idempotencyKey: 'k' }, paying],
    ['CHECKING_OUT + PAID → PURCHASED', paying, { type: 'PAID', lockId: 'L1', orderId: 'DH1', total: 100 }, purchased],
    ['RESERVING + SOLD_OUT → SOLD_OUT (optimistic rollback)', reserving, { type: 'RESERVE_REJECTED', requestId: 2, reason: 'SOLD_OUT' }, soldOut],
    ['RESERVING + NETWORK → FAILED', reserving, { type: 'RESERVE_REJECTED', requestId: 2, reason: 'NETWORK' }, { status: 'FAILED', message: 'Network problem. Please try again.' }],
    ['RESERVING + LIMIT → FAILED', reserving, { type: 'RESERVE_REJECTED', requestId: 2, reason: 'LIMIT_EXCEEDED' }, { status: 'FAILED', message: 'You have reached the per-customer limit for this item.' }],
    ['CHECKING_OUT + DECLINED → RESERVED with notice', paying, { type: 'DECLINED', lockId: 'L1' }, { ...reserved, notice: 'Payment was declined. You can try again while your hold lasts.' }],
    ['RESERVED + EXPIRE(timer) → EXPIRED', reserved, { type: 'EXPIRE', lockId: 'L1', source: 'timer' }, expired],
    ['CHECKING_OUT + EXPIRE(server) → EXPIRED', paying, { type: 'EXPIRE', lockId: 'L1', source: 'server' }, expired],
    ['RESERVED + RELEASE → IDLE', reserved, { type: 'RELEASE' }, IDLE_LOCK],
    ['RESERVING + RELEASE → IDLE (cancel)', reserving, { type: 'RELEASE' }, IDLE_LOCK],
    ['SOLD_OUT + RETRY → IDLE', soldOut, { type: 'RETRY' }, IDLE_LOCK],
    ['EXPIRED + RESERVE → RESERVING (try again directly)', expired, { type: 'RESERVE', requestId: 7 }, { status: 'RESERVING', requestId: 7 }],
  ])('%s', (_name, from, event, to) => {
    const next = lockTransition(from, event);
    expect(next).toEqual(to);
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe('lockTransition: ignored events return the same object', () => {
  it.each<[string, LockState, LockEvent]>([
    ['double click on Reserve while reserving', reserving, { type: 'RESERVE', requestId: 3 }],
    ['double click on Pay while paying', paying, { type: 'CHECKOUT', idempotencyKey: 'other' }],
    ['stale RESERVE_OK from an older request', reserving, { type: 'RESERVE_OK', requestId: 1, lockId: 'L0', expiresAt: 1 }],
    ['stale rejection from an older request', reserving, { type: 'RESERVE_REJECTED', requestId: 1, reason: 'SOLD_OUT' }],
    ['RESERVE_OK after the user cancelled', IDLE_LOCK, { type: 'RESERVE_OK', requestId: 2, lockId: 'L1', expiresAt: 1 }],
    ['client timer firing during checkout', paying, { type: 'EXPIRE', lockId: 'L1', source: 'timer' }],
    ['expiry of another lock', reserved, { type: 'EXPIRE', lockId: 'L9', source: 'timer' }],
    ['PAID for another lock', paying, { type: 'PAID', lockId: 'L9', orderId: 'x', total: 1 }],
    ['Reserve after purchase', purchased, { type: 'RESERVE', requestId: 9 }],
    ['Release after purchase', purchased, { type: 'RELEASE' }],
    ['Retry while holding a lock', reserved, { type: 'RETRY' }],
    ['Checkout without a lock', IDLE_LOCK, { type: 'CHECKOUT', idempotencyKey: 'k' }],
    ['Retry from failed is allowed but RELEASE is not', failed, { type: 'RELEASE' }],
  ])('%s', (_name, from, event) => {
    expect(lockTransition(from, event)).toBe(from);
  });
});

describe('optimistic helpers', () => {
  it('only RESERVING shows a pending unit; RESERVED/CHECKING_OUT hold a server lock', () => {
    const all = [IDLE_LOCK, reserving, reserved, paying, purchased, soldOut, expired, failed];
    expect(all.map(pendingUnits)).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
    expect(all.map(holdsLock)).toEqual([false, false, true, true, false, false, false, false]);
  });
});
