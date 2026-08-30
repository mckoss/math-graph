import { describe, expect, it } from 'vitest';
import { analyzeLayoutRows, rectangleOverlapCount, type LayoutRowNode } from './layout-row-invariant';

const node = (id: string, y: number, x: number, width = 90): LayoutRowNode => ({
  id,
  band: 'elementary',
  x,
  y,
  width,
});

describe('Layout Now row invariant', () => {
  it('places roots first and dependents at one plus their latest parent row', () => {
    const nodes = [node('root-a', 0, -60), node('root-b', 0, 60), node('child', 80, 0)];
    const result = analyzeLayoutRows(nodes, [{ from: 'root-a', to: 'child' }], 300);
    expect(Object.fromEntries(result.rows)).toEqual({ 'root-a': 0, 'root-b': 0, child: 1 });
    expect(result.violations).toEqual([]);
  });

  it('permits a later row only when every earlier dependency-safe row is full', () => {
    const full = [node('root-a', 0, -55, 100), node('root-b', 0, 55, 100), node('root-c', 70, 0, 100)];
    expect(analyzeLayoutRows(full, [], 240, 12).violations).toEqual([]);

    const roomy = [node('root-a', 0, -55, 70), node('root-b', 0, 55, 70), node('root-c', 70, 0, 70)];
    expect(analyzeLayoutRows(roomy, [], 240, 12).violations).toEqual([{
      id: 'root-c',
      actualRow: 1,
      earliestFeasibleRow: 0,
      reason: 'unnecessary-overflow',
    }]);
  });

  it('reports dependency order and rectangle overlaps independently', () => {
    const nodes = [node('parent', 80, 0), node('child', 0, 0)];
    expect(analyzeLayoutRows(nodes, [{ from: 'parent', to: 'child' }], 300).violations)
      .toContainEqual({
        id: 'child',
        actualRow: 0,
        earliestFeasibleRow: 2,
        reason: 'dependency-depth',
      });
    expect(rectangleOverlapCount(
      [node('left', 0, 0), node('right', 20, 30)],
      new Map([['left', 50], ['right', 50]]),
    )).toBe(1);
  });
});
