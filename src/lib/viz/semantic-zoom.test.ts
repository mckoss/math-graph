import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import {
  semanticDepthForZoom,
  semanticProjection,
  semanticZoomThresholds,
  thresholdForGroupDepth,
} from './semantic-zoom';

const graph = {
  metadata: { id: 'test', title: 'Test', topic: 'Test', version: '1' },
  maturityLevels: [],
  nodes: [
    { id: 'root', label: 'Root', isGroup: true, maturityLevel: 'one' },
    { id: 'child', label: 'Child', isGroup: true, parent: 'root', maturityLevel: 'one' },
    { id: 'leaf', label: 'Leaf', isGroup: false, parent: 'child', maturityLevel: 'one' },
  ],
  edges: [],
} as unknown as ConceptGraph;

describe('semantic zoom', () => {
  it('derives ordered reveal points from group sizes at every hierarchy depth', () => {
    const thresholds = semanticZoomThresholds([
      { depth: 0, width: 2_800, height: 1_400 },
      { depth: 1, width: 570, height: 1_300 },
      { depth: 2, width: 490, height: 520 },
    ], { width: 1_200, height: 700 }, 4);

    expect(thresholds).toEqual([
      0.1875,
      0.40384615384615385,
      1.0096153846153846,
      1.3125,
    ]);
    expect(semanticDepthForZoom(0.18, thresholds)).toBe(0);
    expect(semanticDepthForZoom(0.19, thresholds)).toBe(1);
    expect(semanticDepthForZoom(0.5, thresholds)).toBe(2);
    expect(thresholdForGroupDepth(2, thresholds)).toBe(thresholds[2]);
  });

  it('keeps successive reveal levels distinct when deeper groups are larger', () => {
    const thresholds = semanticZoomThresholds([
      { depth: 0, width: 500, height: 400 },
      { depth: 1, width: 1_000, height: 800 },
    ], { width: 1_000, height: 800 }, 3);

    expect(thresholds).toEqual([1.2, 1.56, 2.028]);
  });

  it('changes only the visible paint projection, never the source hierarchy', () => {
    const sourceParents = graph.nodes.map((node) => [node.id, node.parent]);
    expect(semanticProjection(graph, 0).nodes.map((node) => node.id)).toEqual(['root']);
    expect(semanticProjection(graph, 1).nodes.map((node) => node.id)).toEqual(['root', 'child']);
    expect(semanticProjection(graph, 2).nodes.map((node) => node.id)).toEqual([
      'root',
      'child',
      'leaf',
    ]);
    expect(graph.nodes.map((node) => [node.id, node.parent])).toEqual(sourceParents);
  });
});
