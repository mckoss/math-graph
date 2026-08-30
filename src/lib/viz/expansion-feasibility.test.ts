import { describe, expect, it } from 'vitest';
import {
  feasibleRequestedGroups,
  dependencyRanks,
  minimumFeasibleZoom,
  nonContainmentOverlapCount,
} from './expansion-feasibility';

describe('expansion feasibility', () => {
  it('binary-searches the first safe global zoom', () => {
    const zoom = minimumFeasibleZoom((candidate) => candidate >= 2.375, {
      startZoom: 0.8,
      maximumZoom: 8,
    });
    expect(zoom).not.toBeNull();
    expect(zoom!).toBeGreaterThanOrEqual(2.375);
    expect(zoom!).toBeLessThan(2.376);
  });

  it('reports an expansion that cannot be made safe', () => {
    expect(minimumFeasibleZoom(() => false, { startZoom: 1, maximumZoom: 8 })).toBeNull();
  });

  it('retains intent while applying hierarchy and reopen hysteresis', () => {
    const requested = new Set(['outer', 'inner']);
    const parents = new Map<string, string | undefined>([['outer', undefined], ['inner', 'outer']]);
    const thresholds = new Map([['outer', 1.5], ['inner', 2]]);
    expect(feasibleRequestedGroups(requested, requested, thresholds, 1.8, parents)).toEqual(
      new Set(['outer']),
    );
    expect(feasibleRequestedGroups(requested, new Set(), thresholds, 1.55, parents)).toEqual(
      new Set(),
    );
    expect(feasibleRequestedGroups(requested, new Set(), thresholds, 2.2, parents)).toEqual(
      new Set(['outer', 'inner']),
    );
  });

  it('counts sibling and exterior overlaps but ignores ancestor containment', () => {
    const blocks = [
      { id: 'group', x1: 0, y1: 0, x2: 100, y2: 100 },
      { id: 'child-a', parentId: 'group', x1: 10, y1: 10, x2: 55, y2: 45 },
      { id: 'child-b', parentId: 'group', x1: 50, y1: 10, x2: 90, y2: 45 },
      { id: 'outside', x1: 88, y1: 15, x2: 125, y2: 50 },
    ];
    // child-a/child-b and child-b/outside overlap. The group legitimately
    // contains both children, but overlaps the exterior block illegitimately.
    expect(nonContainmentOverlapCount(blocks)).toBe(3);
  });

  it('places every dependent in a later internal rank', () => {
    const ranks = dependencyRanks(['point', 'line', 'angle', 'triangle'], [
      { from: 'point', to: 'line' },
      { from: 'line', to: 'angle' },
      { from: 'angle', to: 'triangle' },
      { from: 'outside', to: 'triangle' },
    ]);
    expect(Object.fromEntries(ranks)).toEqual({ point: 0, line: 1, angle: 2, triangle: 3 });
  });
});
