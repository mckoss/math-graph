import { describe, expect, it } from 'vitest';

import {
  constrainPointToVerticalDependencyOrder,
  countVerticalDependencyOrderViolations,
  enforceVerticalDependencyOrder,
} from './vertical-order';

describe('vertical dependency order', () => {
  it('pushes each dependent strictly below all of its prerequisites', () => {
    const positions = new Map([
      ['early', { x: 0, y: 100 }],
      ['other-parent', { x: 20, y: 90 }],
      ['later', { x: 40, y: 40 }],
      ['latest', { x: 60, y: 20 }],
    ]);
    const edges = [
      { from: 'early', to: 'later' },
      { from: 'other-parent', to: 'later' },
      { from: 'later', to: 'latest' },
    ];

    const result = enforceVerticalDependencyOrder(positions, edges, 12);

    expect(result.get('early')).toEqual({ x: 0, y: 100 });
    expect(result.get('later')?.y).toBe(112);
    expect(result.get('latest')?.y).toBe(124);
    expect(countVerticalDependencyOrderViolations(result, edges, 12)).toBe(0);
  });

  it('clamps upward dragging at prerequisites but permits downward dragging', () => {
    const positions = new Map([
      ['parent-a', { x: 0, y: 40 }],
      ['parent-b', { x: 0, y: 60 }],
      ['node', { x: 0, y: 80 }],
      ['child-a', { x: 0, y: 120 }],
      ['child-b', { x: 0, y: 140 }],
    ]);
    const edges = [
      { from: 'parent-a', to: 'node' },
      { from: 'parent-b', to: 'node' },
      { from: 'node', to: 'child-a' },
      { from: 'node', to: 'child-b' },
    ];

    expect(constrainPointToVerticalDependencyOrder('node', { x: 9, y: 20 }, positions, edges, 10))
      .toEqual({ x: 9, y: 70 });
    expect(constrainPointToVerticalDependencyOrder('node', { x: 9, y: 160 }, positions, edges, 10))
      .toEqual({ x: 9, y: 160 });
  });
});
