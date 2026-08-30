import { describe, expect, it } from 'vitest';
import { compactRanksTowardCenterline } from './centerline-layout';

describe('compactRanksTowardCenterline', () => {
  it('centers ranks compactly while preserving Dagre left-to-right order', () => {
    const result = compactRanksTowardCenterline([
      { id: 'left', band: 0, point: { x: -500, y: 20 }, width: 100, height: 40 },
      { id: 'right', band: 0, point: { x: 500, y: 20 }, width: 80, height: 40 },
      { id: 'lower', band: 0, point: { x: 900, y: 72 }, width: 60, height: 40 },
    ], 10, 20);

    expect(result.get('left')!.x).toBeLessThan(result.get('right')!.x);
    expect(result.get('right')!.x - result.get('left')!.x).toBe(110);
    expect((result.get('left')!.x - 50 + result.get('right')!.x + 40) / 2).toBeCloseTo(10);
    expect(result.get('lower')).toEqual({ x: 10, y: 72 });
  });
});
