import type { PhaseInfo, SalePhase, SaleSchedule } from './types';

/**
 *   UPCOMING ──(now ≥ startsAt)──► LIVE ──(now ≥ endsAt)──► ENDED
 *
 * Derived from (server) time on every read instead of being stored: a phase can never be stale,
 * skipped or reached out of order, whatever the timers did.
 */
export function salePhase(schedule: SaleSchedule, now: number): PhaseInfo {
  if (!(schedule.endsAt > schedule.startsAt)) throw new RangeError('Sale must end after it starts');
  if (now < schedule.startsAt) return { phase: 'UPCOMING', nextChangeAt: schedule.startsAt };
  if (now < schedule.endsAt) return { phase: 'LIVE', nextChangeAt: schedule.endsAt };
  return { phase: 'ENDED', nextChangeAt: null };
}

export const PHASE_LABEL: Readonly<Record<SalePhase, string>> = {
  UPCOMING: 'Starts in',
  LIVE: 'Ends in',
  ENDED: 'Sale ended',
};

/** Next 11.11 00:00 in Vietnam (UTC+7, no DST) on or after `now`. */
export function nextElevenEleven(now: number): number {
  const VN_OFFSET = 7 * 3_600_000;
  const local = new Date(now + VN_OFFSET);
  let year = local.getUTCFullYear();
  let target = Date.UTC(year, 10, 11) - VN_OFFSET;
  if (target < now) {
    year += 1;
    target = Date.UTC(year, 10, 11) - VN_OFFSET;
  }
  return target;
}
