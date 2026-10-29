import { nextElevenEleven, salePhase } from '../src/sale/phase';

const schedule = { startsAt: 10_000, endsAt: 70_000 };

describe('salePhase', () => {
  it.each([
    [0, 'UPCOMING', 10_000],
    [9_999, 'UPCOMING', 10_000],
    [10_000, 'LIVE', 70_000], // boundary belongs to the next phase
    [69_999, 'LIVE', 70_000],
    [70_000, 'ENDED', null],
    [1e12, 'ENDED', null],
  ] as const)('t=%d → %s (next change %s)', (now, phase, next) => {
    expect(salePhase(schedule, now)).toEqual({ phase, nextChangeAt: next });
  });

  it('moves strictly forward as time increases', () => {
    const order = ['UPCOMING', 'LIVE', 'ENDED'];
    let last = 0;
    for (let t = 0; t <= 80_000; t += 997) {
      const index = order.indexOf(salePhase(schedule, t).phase);
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
    expect(last).toBe(2);
  });

  it('rejects a schedule that ends before it starts', () => {
    expect(() => salePhase({ startsAt: 5, endsAt: 5 }, 0)).toThrow(RangeError);
  });
});

describe('nextElevenEleven', () => {
  it('is midnight 11/11 in Vietnam (17:00 UTC on 10/11)', () => {
    const target = nextElevenEleven(Date.UTC(2026, 9, 29, 3, 0)); // 29 Oct 2026
    expect(new Date(target).toISOString()).toBe('2026-11-10T17:00:00.000Z');
  });

  it('rolls over to next year once this year has passed', () => {
    const target = nextElevenEleven(Date.UTC(2026, 10, 10, 18, 0)); // already 11/11 01:00 in VN
    expect(new Date(target).toISOString()).toBe('2027-11-10T17:00:00.000Z');
  });
});
