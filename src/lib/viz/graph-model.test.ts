import { describe, expect, it } from 'vitest';
import { sampleGraph } from '../sample-graph';
import type { ConceptGraph } from '../types';
import { computeVisible, nodesById, representativeOf } from './graph-model';

const byId = nodesById(sampleGraph);
const none = new Set<string>();

describe('computeVisible', () => {
  it('shows collapsed groups plus parentless nodes when nothing is expanded', () => {
    const vis = computeVisible(sampleGraph, none);
    expect(vis.nodes.map((n) => n.id).sort()).toEqual(
      ['algebra', 'arithmetic', 'functions', 'geometry'].sort(),
    );
  });

  it('remaps edges to group representatives without duplicates or self-loops', () => {
    const vis = computeVisible(sampleGraph, none);
    const keys = vis.edges.map((e) => `${e.from}->${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(vis.edges.every((e) => e.from !== e.to)).toBe(true);
    expect(keys).toContain('arithmetic->algebra');
    expect(keys).toContain('arithmetic->geometry');
    expect(keys).toContain('algebra->functions');
    expect(keys).toContain('functions->geometry');
  });

  it('keeps an expanded group as the parent of its visible children', () => {
    const vis = computeVisible(sampleGraph, new Set(['arithmetic']));
    const ids = vis.nodes.map((n) => n.id);
    expect(ids).toContain('arithmetic');
    expect(ids).toEqual(
      expect.arrayContaining(['counting', 'addition', 'multiplication', 'fractions']),
    );
    const keys = vis.edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain('fractions->algebra');
    expect(keys).toContain('multiplication->geometry');
  });

  it('preserves nested groups until each level is expanded', () => {
    const graph: ConceptGraph = {
      metadata: { id: 'example', topic: 'Example' },
      maturityLevels: [],
      nodes: [
        { id: 'root-group', label: 'Root', isGroup: true },
        { id: 'nested-group', label: 'Nested', isGroup: true, parent: 'root-group' },
        {
          id: 'nested-concept',
          label: 'Concept',
          isGroup: false,
          parent: 'nested-group',
          maturityLevel: 'elementary',
        },
      ],
      edges: [],
    };

    const oneLevel = computeVisible(graph, new Set(['root-group']));
    expect(oneLevel.nodes.map((node) => node.id)).toEqual(['root-group', 'nested-group']);
    expect(representativeOf(nodesById(graph), new Set(['root-group']), 'nested-concept')).toBe(
      'nested-group',
    );

    const twoLevels = computeVisible(graph, new Set(['root-group', 'nested-group']));
    expect(twoLevels.nodes.map((node) => node.id)).toEqual([
      'root-group',
      'nested-group',
      'nested-concept',
    ]);
  });

  it('flags an aggregate edge when any represented concept edge reverses history', () => {
    const graph: ConceptGraph = {
      metadata: { id: 'history', topic: 'History' },
      maturityLevels: [],
      nodes: [
        { id: 'sources', label: 'Sources', isGroup: true },
        { id: 'targets', label: 'Targets', isGroup: true },
        { id: 'source-a', label: 'Source A', isGroup: false, parent: 'sources' },
        { id: 'source-b', label: 'Source B', isGroup: false, parent: 'sources' },
        { id: 'target-a', label: 'Target A', isGroup: false, parent: 'targets' },
        { id: 'target-b', label: 'Target B', isGroup: false, parent: 'targets' },
      ],
      edges: [
        { from: 'source-a', to: 'target-a' },
        { from: 'source-b', to: 'target-b', historicalOrderMismatch: true },
      ],
    };

    expect(computeVisible(graph, none).edges).toEqual([
      { from: 'sources', to: 'targets', historicalOrderMismatch: true },
    ]);
  });

  it('retains source provenance only when every edge in an aggregate is source-supported', () => {
    const graph: ConceptGraph = {
      metadata: { id: 'provenance', topic: 'Provenance' },
      maturityLevels: [],
      nodes: [
        { id: 'sources', label: 'Sources', isGroup: true },
        { id: 'targets', label: 'Targets', isGroup: true },
        { id: 'source-a', label: 'Source A', isGroup: false, parent: 'sources' },
        { id: 'source-b', label: 'Source B', isGroup: false, parent: 'sources' },
        { id: 'target-a', label: 'Target A', isGroup: false, parent: 'targets' },
        { id: 'target-b', label: 'Target B', isGroup: false, parent: 'targets' },
      ],
      edges: [
        { from: 'source-a', to: 'target-a', provenance: 'source-supported' },
        { from: 'source-b', to: 'target-b', provenance: 'source-supported' },
      ],
    };

    expect(computeVisible(graph, none).edges).toEqual([
      { from: 'sources', to: 'targets', provenance: 'source-supported' },
    ]);

    graph.edges[1].provenance = 'inferred';
    expect(computeVisible(graph, none).edges).toEqual([{ from: 'sources', to: 'targets' }]);
  });
});

describe('representativeOf', () => {
  it('maps hidden children to their collapsed group', () => {
    expect(representativeOf(byId, none, 'addition')).toBe('arithmetic');
  });

  it('maps visible nodes to themselves', () => {
    expect(representativeOf(byId, none, 'functions')).toBe('functions');
    expect(representativeOf(byId, new Set(['algebra']), 'variables')).toBe('variables');
  });

  it('keeps an expanded group visible as its own representative', () => {
    expect(representativeOf(byId, new Set(['algebra']), 'algebra')).toBe('algebra');
  });
});
