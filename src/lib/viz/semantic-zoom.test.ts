import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import {
  semanticDepthForZoom,
  semanticProjection,
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
  it('reveals one hierarchy level at each global threshold', () => {
    expect(semanticDepthForZoom(0.999)).toBe(0);
    expect(semanticDepthForZoom(1)).toBe(1);
    expect(semanticDepthForZoom(1.749)).toBe(1);
    expect(semanticDepthForZoom(1.75)).toBe(2);
    expect(thresholdForGroupDepth(0)).toBe(1);
    expect(thresholdForGroupDepth(1)).toBe(1.75);
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
