import { describe, expect, it } from 'vitest';
import { hasHistoricalOrderMismatch, historyEnd, historyStart } from './history-order';

describe('historical dependency order', () => {
  it('reads open and closed development ranges', () => {
    expect(historyStart({ from: -300, to: 200 })).toBe(-300);
    expect(historyEnd({ from: -300, to: 200 })).toBe(200);
    expect(historyStart({ to: 1600 })).toBe(1600);
    expect(historyEnd({ from: 1700 })).toBe(1700);
  });

  it('flags a prerequisite recorded wholly after its dependent', () => {
    expect(hasHistoricalOrderMismatch({ from: 1817, to: 1861 }, { from: 1665, to: 1684 }))
      .toBe(true);
  });

  it('does not overstate missing or overlapping historical evidence', () => {
    expect(hasHistoricalOrderMismatch(undefined, { from: 1600 })).toBe(false);
    expect(hasHistoricalOrderMismatch({ from: 1650, to: 1750 }, { from: 1700, to: 1800 }))
      .toBe(false);
    expect(hasHistoricalOrderMismatch({ from: 1500 }, { from: 1600 })).toBe(false);
  });
});
