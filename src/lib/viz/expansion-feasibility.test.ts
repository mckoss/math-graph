import { describe, expect, it } from 'vitest';
import { dependencyRanks, nonContainmentOverlapCount } from './expansion-feasibility';

describe('expansion feasibility', () => {
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
