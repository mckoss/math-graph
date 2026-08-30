import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import schema from '../../data/knowledge-base.schema.json';
import type { ConceptEdge, ConceptGraph, GraphNode } from '../types';
import { hasHistoricalOrderMismatch } from './history-order';
import { loadKnowledgeGraphCatalog } from './catalog';
import { loadKnowledgeBase } from './load';

const validate = new Ajv({ allErrors: true }).compile(schema);
const bundledSources = import.meta.glob('../../data/graphs/*.yaml', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;
const commonCoreOutlineSources = import.meta.glob('../../../docs/cc-math-outline.txt', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;
const commonCoreOutline = Object.values(commonCoreOutlineSources)[0];
if (!commonCoreOutline) throw new Error('Common Core Math outline not found');
const bundledDocuments = Object.entries(bundledSources).map(([path, source]) => ({
  path,
  document: parse(source, { uniqueKeys: true }),
}));
const bundledGraphs = loadKnowledgeGraphCatalog(bundledSources);
const graph = bundledGraphs.find((candidate) => candidate.metadata.id === 'math');
if (!graph) throw new Error('Bundled Math graph not found');
const groups = graph.nodes.filter((node) => node.isGroup);
const concepts = graph.nodes.filter((node) => !node.isGroup);

const minimalDocument = {
  metadata: { id: 'example', topic: 'Example' },
  maturityLevels: [
    { id: 'elementary', label: 'Elementary', order: 1, color: '#111111', tint: '#eeeeee' },
  ],
  groups: [{ id: 'basics', label: 'Basics', maturityLevel: 'elementary' }],
  concepts: [
    { id: 'counting', label: 'Counting', group: 'basics', maturityLevel: 'elementary' },
  ],
  dependencies: [],
};

function nodeById(nodes: GraphNode[], id: string): GraphNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`node "${id}" not found`);
  return node;
}

function cycleIn(edges: ConceptEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.from) ?? [];
    outgoing.push(edge.to);
    adjacency.set(edge.from, outgoing);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return null;
    visiting.add(id);
    path.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const id of adjacency.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

describe('knowledge-base schema', () => {
  it('accepts every bundled graph dataset', () => {
    expect(bundledDocuments.length).toBeGreaterThanOrEqual(2);
    for (const { path, document } of bundledDocuments) {
      expect(validate(document), `${path}: ${JSON.stringify(validate.errors, null, 2)}`).toBe(true);
    }
  });

  it('restricts history to concepts and excludes year zero', () => {
    const groupHistory = structuredClone(minimalDocument) as Record<string, unknown>;
    (groupHistory.groups as Array<Record<string, unknown>>)[0].history = { from: 1 };
    expect(validate(groupHistory)).toBe(false);

    const yearZero = structuredClone(minimalDocument) as Record<string, unknown>;
    (yearZero.concepts as Array<Record<string, unknown>>)[0].history = { from: 0 };
    expect(validate(yearZero)).toBe(false);
  });
});

describe('loadKnowledgeBase', () => {
  it('uses standard YAML duplicate-key handling', () => {
    expect(() => loadKnowledgeBase('concepts:\n  - id: a\n    id: b\n    label: A\n')).toThrow();
  });

  it('mechanically flattens groups and expands dependency chains', () => {
    const loaded = loadKnowledgeBase([
      'metadata:',
      '  id: example',
      '  topic: Example',
      'maturityLevels:',
      '  - id: elementary',
      '    label: Elementary',
      '    order: 1',
      '    color: "#111111"',
      '    tint: "#eeeeee"',
      'groups:',
      '  - id: basics',
      '    label: Basics',
      '    maturityLevel: elementary',
      '    groups:',
      '      - id: numbers',
      '        label: Numbers',
      '        maturityLevel: elementary',
      'concepts:',
      '  - id: counting',
      '    label: Counting',
      '    group: numbers',
      '    maturityLevel: elementary',
      '  - id: algebra',
      '    label: Algebra',
      '    group: basics',
      '    maturityLevel: elementary',
      'dependencies:',
      '  - counting -> algebra -> counting',
    ].join('\n'));

    expect(loaded.maturityLevels).toHaveLength(1);
    expect(loaded.metadata).toEqual({ id: 'example', topic: 'Example' });
    expect(loaded.nodes).toEqual([
      { id: 'basics', label: 'Basics', maturityLevel: 'elementary', isGroup: true },
      {
        id: 'numbers',
        label: 'Numbers',
        maturityLevel: 'elementary',
        parent: 'basics',
        isGroup: true,
      },
      {
        id: 'counting',
        label: 'Counting',
        maturityLevel: 'elementary',
        parent: 'numbers',
        isGroup: false,
      },
      {
        id: 'algebra',
        label: 'Algebra',
        maturityLevel: 'elementary',
        parent: 'basics',
        isGroup: false,
      },
    ]);
    expect(loaded.edges).toEqual([
      { from: 'counting', to: 'algebra' },
      { from: 'algebra', to: 'counting' },
    ]);
  });

  it('loads provenance-grouped dependency paths without changing compact chain syntax', () => {
    const loaded = loadKnowledgeBase([
      'metadata:',
      '  id: example',
      '  topic: Example',
      'maturityLevels:',
      '  - id: elementary',
      '    label: Elementary',
      '    order: 1',
      '    color: "#111111"',
      '    tint: "#eeeeee"',
      'groups:',
      '  - id: basics',
      '    label: Basics',
      '    maturityLevel: elementary',
      'concepts:',
      '  - id: counting',
      '    label: Counting',
      '    group: basics',
      '    maturityLevel: elementary',
      '  - id: numbers',
      '    label: Numbers',
      '    group: basics',
      '    maturityLevel: elementary',
      '  - id: algebra',
      '    label: Algebra',
      '    group: basics',
      '    maturityLevel: elementary',
      'dependencies:',
      '  sourceSupported:',
      '    - counting -> numbers',
      '  inferred:',
      '    - numbers -> algebra',
    ].join('\n'));

    expect(loaded.edges).toEqual([
      { from: 'counting', to: 'numbers', provenance: 'source-supported' },
      { from: 'numbers', to: 'algebra', provenance: 'inferred' },
    ]);
  });

  it('rejects a child assigned to a different maturity zone than its group', () => {
    expect(() =>
      loadKnowledgeBase([
        'groups:',
        '  - id: basics',
        '    label: Basics',
        '    maturityLevel: elementary',
        'concepts:',
        '  - id: algebra',
        '    label: Algebra',
        '    group: basics',
        '    maturityLevel: high-school',
      ].join('\n')),
    ).toThrow(/Group basics is in maturity zone elementary/);
  });

  it('rejects group ids anywhere in a dependency chain', () => {
    const source = (dependency: string) =>
      [
        'groups:',
        '  - id: basics',
        '    label: Basics',
        '    maturityLevel: elementary',
        'concepts:',
        '  - id: counting',
        '    label: Counting',
        '    group: basics',
        '    maturityLevel: elementary',
        'dependencies:',
        `  - ${dependency}`,
      ].join('\n');

    expect(() => loadKnowledgeBase(source('basics -> counting'))).toThrow(
      /Dependency endpoint basics is a group; dependencies may reference concepts only/,
    );
    expect(() => loadKnowledgeBase(source('counting -> basics'))).toThrow(
      /Dependency endpoint basics is a group; dependencies may reference concepts only/,
    );
  });

  it('rejects ids shared by a group and a concept', () => {
    expect(() =>
      loadKnowledgeBase([
        'groups:',
        '  - id: basics',
        '    label: Basics',
        '    maturityLevel: elementary',
        'concepts:',
        '  - id: basics',
        '    label: A concept also named basics',
        '    group: basics',
        '    maturityLevel: elementary',
      ].join('\n')),
    ).toThrow(/Duplicate group or concept id: basics/);
  });
});

describe('knowledge-base graph invariants', () => {
  it('loads every bundled graph with internally consistent hierarchy and dependencies', () => {
    for (const bundledGraph of bundledGraphs) {
      const levelIds = new Set(bundledGraph.maturityLevels.map((level) => level.id));
      const nodesById = new Map(bundledGraph.nodes.map((node) => [node.id, node]));
      expect(nodesById.size, bundledGraph.metadata.id).toBe(bundledGraph.nodes.length);

      for (const node of bundledGraph.nodes) {
        expect(levelIds.has(node.maturityLevel ?? ''), `${bundledGraph.metadata.id}:${node.id}`).toBe(
          true,
        );
        if (node.parent !== undefined) {
          const parent = nodesById.get(node.parent);
          expect(parent?.isGroup, `${bundledGraph.metadata.id}:${node.id}`).toBe(true);
          expect(node.maturityLevel, `${bundledGraph.metadata.id}:${node.id}`).toBe(
            parent?.maturityLevel,
          );
        }
      }

      for (const edge of bundledGraph.edges) {
        expect(nodesById.get(edge.from)?.isGroup, `${bundledGraph.metadata.id}:${edge.from}`).toBe(
          false,
        );
        expect(nodesById.get(edge.to)?.isGroup, `${bundledGraph.metadata.id}:${edge.to}`).toBe(
          false,
        );
      }
      expect(cycleIn(bundledGraph.edges), bundledGraph.metadata.id).toBeNull();
    }
  });

  it('keeps the Common Core standard graph and text outline complete and synchronized', () => {
    const commonCore = bundledGraphs.find((candidate) => candidate.metadata.id === 'cc-math');
    if (!commonCore) throw new Error('Bundled Common Core Math graph not found');

    expect(commonCore.maturityLevels.map((level) => level.id)).toEqual([
      'kindergarten',
      'grade-1',
      'grade-2',
      'grade-3',
      'grade-4',
      'grade-5',
      'grade-6',
      'grade-7',
      'grade-8',
      'high-school',
    ]);
    const incoming = new Set(commonCore.edges.map((edge) => edge.to));
    const standardConcepts = commonCore.nodes.filter(
      (node) => !node.isGroup && node.id !== 'hs-modeling-cycle',
    );
    expect(standardConcepts).toHaveLength(385);
    for (const concept of standardConcepts) {
      expect(concept.label, concept.id).toMatch(
        /^(?:(?:K|[1-8])\.[A-Z]+|[A-Z]+-[A-Z]+)\.\d+(?: \(\+\))? — \S.+/,
      );
    }

    const laterConcepts = commonCore.nodes.filter(
      (node) => !node.isGroup && node.maturityLevel !== 'kindergarten',
    );
    for (const concept of laterConcepts) {
      expect(incoming, concept.id).toContain(concept.id);
    }
    expect(commonCore.edges.some((edge) => edge.provenance === 'source-supported')).toBe(true);
    expect(commonCore.edges.some((edge) => edge.provenance === 'inferred')).toBe(true);

    const outlineLines = new Set(
      commonCoreOutline.split('\n').map((line) => line.trim()).filter(Boolean),
    );
    for (const node of commonCore.nodes) {
      expect(outlineLines, node.id).toContain(node.label);
    }
  });

  it('uses globally unique display titles for every group and concept', () => {
    for (const bundledGraph of bundledGraphs) {
      const nodeIdsByTitle = new Map<string, string[]>();
      for (const node of bundledGraph.nodes) {
        const ids = nodeIdsByTitle.get(node.label) ?? [];
        ids.push(node.id);
        nodeIdsByTitle.set(node.label, ids);
      }

      const duplicates = [...nodeIdsByTitle.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([title, ids]) => `${JSON.stringify(title)} (${ids.join(', ')})`);
      expect(duplicates, bundledGraph.metadata.id).toEqual([]);
    }
  });

  it('uses maturity prefixes on group titles only to disambiguate a repeated subject', () => {
    for (const bundledGraph of bundledGraphs) {
      const levelLabels = new Map(
        bundledGraph.maturityLevels.map((level) => [level.id, level.label]),
      );
      const graphGroups = bundledGraph.nodes.filter((node) => node.isGroup);
      const baseTitle = (group: GraphNode) => {
        const prefix = `${levelLabels.get(group.maturityLevel ?? '') ?? ''} `;
        return group.label.startsWith(prefix) ? group.label.slice(prefix.length) : group.label;
      };

      for (const group of graphGroups) {
        const levelPrefix = `${levelLabels.get(group.maturityLevel ?? '') ?? ''} `;
        if (!group.label.startsWith(levelPrefix)) continue;
        const matchingSubjects = graphGroups.filter(
          (candidate) => baseTitle(candidate) === baseTitle(group),
        );
        expect(matchingSubjects.length, `${bundledGraph.metadata.id}:${group.id}`).toBeGreaterThan(1);
      }
    }
  });

  it('uses unique configured maturity levels and valid concept references', () => {
    const ids = graph.maturityLevels.map((level) => level.id);
    const orders = graph.maturityLevels.map((level) => level.order);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(orders).size).toBe(orders.length);
    expect(new Set([...ids, ...graph.nodes.map((node) => node.id)]).size).toBe(
      ids.length + graph.nodes.length,
    );
    const known = new Set(ids);
    for (const concept of concepts) expect(known.has(concept.maturityLevel!), concept.id).toBe(true);
    for (const level of graph.maturityLevels) {
      if (level.gradeRange) expect(level.gradeRange.from, level.id).toBeLessThanOrEqual(level.gradeRange.to);
    }
  });

  it('has globally unique node ids and valid group membership', () => {
    const ids = graph.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);

    const groupIds = new Set(groups.map((group) => group.id));
    for (const concept of concepts) {
      expect(concept.parent, concept.id).toBeDefined();
      expect(groupIds.has(concept.parent!), concept.id).toBe(true);
    }
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const node of graph.nodes) {
      if (node.parent === undefined) continue;
      expect(node.maturityLevel, node.id).toBe(byId.get(node.parent)?.maturityLevel);
    }
  });

  it('has only unique, non-self concept dependencies with known endpoints', () => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const groupIds = new Set(groups.map((group) => group.id));
    const edgeKeys = new Set<string>();
    for (const edge of graph.edges) {
      expect(ids.has(edge.from), edge.from).toBe(true);
      expect(ids.has(edge.to), edge.to).toBe(true);
      expect(groupIds.has(edge.from), edge.from).toBe(false);
      expect(groupIds.has(edge.to), edge.to).toBe(false);
      expect(edge.from).not.toBe(edge.to);
      const key = `${edge.from}\0${edge.to}`;
      expect(edgeKeys.has(key), `${edge.from} -> ${edge.to}`).toBe(false);
      edgeKeys.add(key);
    }
  });

  it('is acyclic', () => {
    expect(cycleIn(graph.edges)).toBeNull();
  });

  it('orders dependencies from the same or an earlier maturity level', () => {
    const order = new Map(graph.maturityLevels.map((level) => [level.id, level.order]));
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    for (const edge of graph.edges) {
      const from = order.get(byId.get(edge.from)?.maturityLevel ?? '');
      const to = order.get(byId.get(edge.to)?.maturityLevel ?? '');
      expect(from, edge.from).toBeDefined();
      expect(to, edge.to).toBeDefined();
      expect(from!, `${edge.from} -> ${edge.to}`).toBeLessThanOrEqual(to!);
    }
  });

  it('uses ordered, nonzero signed historical years', () => {
    for (const concept of concepts) {
      const history = concept.history;
      if (!history) continue;
      expect(history.from ?? history.to, concept.id).toBeDefined();
      if (history.from !== undefined) expect(history.from, concept.id).not.toBe(0);
      if (history.to !== undefined) expect(history.to, concept.id).not.toBe(0);
      if (history.from !== undefined && history.to !== undefined) {
        expect(history.from, concept.id).toBeLessThanOrEqual(history.to);
      }
    }
  });

  it('flags every dependency with definitely reversed recorded history', () => {
    const byId = new Map(concepts.map((concept) => [concept.id, concept]));
    for (const edge of graph.edges) {
      const expected = hasHistoricalOrderMismatch(
        byId.get(edge.from)?.history,
        byId.get(edge.to)?.history,
      );
      expect(Boolean(edge.historicalOrderMismatch), `${edge.from} -> ${edge.to}`).toBe(expected);
    }

    expect(nodeById(concepts, 'number-line').history).toBeDefined();
    expect(graph.edges).toContainEqual({ from: 'integers', to: 'number-line' });
    expect(graph.edges).toContainEqual({
      from: 'limits',
      to: 'derivatives',
      historicalOrderMismatch: true,
    });
  });

  it('retains the expected graph coverage and metadata', () => {
    expect(groups.length).toBe(22);
    expect(concepts.length).toBeGreaterThanOrEqual(60);
    expect(concepts.length).toBeLessThanOrEqual(100);
    expect(graph.edges.length).toBeGreaterThanOrEqual(100);

    for (const concept of concepts) {
      expect(concept.wikipedia, concept.id).toBeTruthy();
      expect(concept.maturityLevel, concept.id).toBeTruthy();
      expect(concept.description, concept.id).toBeTruthy();
    }
    expect(concepts.filter((concept) => concept.history).length).toBeGreaterThanOrEqual(85);
    expect(nodeById(concepts, 'derivatives').history?.attributions?.map(({ name }) => name)).toEqual([
      'Isaac Newton',
      'Gottfried Wilhelm Leibniz',
    ]);
  });

  it('keeps representative cross-group dependencies derivable from concept edges', () => {
    const parentOf = new Map(graph.nodes.map((node) => [node.id, node.parent]));
    const derived = new Set<string>();
    for (const edge of graph.edges) {
      const from = parentOf.get(edge.from);
      const to = parentOf.get(edge.to);
      if (from && to && from !== to) derived.add(`${from} -> ${to}`);
    }
    for (const link of [
      'numbers -> arithmetic',
      'arithmetic -> elementary-number-systems',
      'arithmetic -> elementary-geometry',
      'elementary-geometry -> high-school-geometry',
      'elementary-number-systems -> elementary-probability-statistics',
      'high-school-functions-and-graphs -> high-school-calculus',
      'elementary-algebra -> trigonometry',
      'elementary-functions-and-graphs -> high-school-probability-statistics',
      'high-school-discrete-math -> abstract-algebra',
      'high-school-geometry -> trigonometry',
      'high-school-linear-algebra -> undergraduate-linear-algebra',
    ]) {
      expect(derived, link).toContain(link);
    }
  });

  it('keeps deliberate conceptual roots instead of inventing weak links', () => {
    const withIncoming = new Set(graph.edges.map((edge) => edge.to));
    const roots = concepts
      .filter((concept) => !withIncoming.has(concept.id))
      .map((concept) => concept.id)
      .sort();
    expect(roots).toEqual([
      'angles',
      'area',
      'circles',
      'congruence',
      'counting',
      'descriptive-statistics',
      'functions',
      'graph-theory',
      'logic',
      'matrices',
      'points-lines-and-planes',
      'proofs',
      'sets',
      'triangles',
      'variables',
      'vectors',
      'volume',
    ]);
  });
});
