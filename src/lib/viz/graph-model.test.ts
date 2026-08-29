import { describe, expect, it } from 'vitest';
import { sampleGraph } from '../sample-graph';
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

  it('replaces an expanded group with its children', () => {
    const vis = computeVisible(sampleGraph, new Set(['arithmetic']));
    const ids = vis.nodes.map((n) => n.id);
    expect(ids).not.toContain('arithmetic');
    expect(ids).toEqual(
      expect.arrayContaining(['counting', 'addition', 'multiplication', 'fractions']),
    );
    const keys = vis.edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain('fractions->algebra');
    expect(keys).toContain('multiplication->geometry');
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

  it('hides an expanded group itself', () => {
    expect(representativeOf(byId, new Set(['algebra']), 'algebra')).toBeNull();
  });
});
