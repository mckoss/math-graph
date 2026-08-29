import { describe, expect, it } from 'vitest';
import { captureLocalLayout, restoreLocalLayout } from './session-layout';

describe('session group layout', () => {
  it('restores horizontal offsets and maturity-relative vertical positions', () => {
    const originalBands = [{ band: 0, y1: 100, y2: 300, count: 1 }];
    const nodes = [
      { id: 'variables', band: 0, point: { x: 130, y: 200 }, width: 80, height: 40 },
    ];
    const saved = captureLocalLayout(100, nodes, originalBands);
    const resizedBands = [{ band: 0, y1: 200, y2: 600, count: 1 }];
    const restored = restoreLocalLayout(300, saved, nodes, resizedBands);

    expect(restored.get('variables')!.x).toBe(330);
    expect(restored.get('variables')!.y).toBe(400);
  });

  it('ignores nodes that have no saved position', () => {
    const restored = restoreLocalLayout(
      100,
      new Map(),
      [{ id: 'new-node', band: 0, point: { x: 0, y: 0 }, width: 80, height: 40 }],
      [{ band: 0, y1: 0, y2: 200, count: 1 }],
    );
    expect(restored.size).toBe(0);
  });
});
