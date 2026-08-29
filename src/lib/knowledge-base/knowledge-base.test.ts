import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import schema from '../../data/knowledge-base.schema.json';
import knowledgeBaseRaw from '../../data/knowledge-base.yaml?raw';
import type { ConceptEdge, ConceptGraph, GraphNode } from '../types';
import { loadKnowledgeBase } from './load';

const validate = new Ajv({ allErrors: true }).compile(schema);
const sourceDocument = parse(knowledgeBaseRaw, { uniqueKeys: true });
const graph = loadKnowledgeBase(knowledgeBaseRaw);
const groups = graph.nodes.filter((node) => node.isGroup);
const concepts = graph.nodes.filter((node) => !node.isGroup);

const minimalDocument = {
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
  it('accepts the canonical YAML document', () => {
    expect(validate(sourceDocument), JSON.stringify(validate.errors, null, 2)).toBe(true);
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
});

describe('knowledge-base graph invariants', () => {
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
      'arithmetic -> elementary-probability-statistics',
      'elementary-number-systems -> elementary-algebra',
      'elementary-algebra -> elementary-functions-and-graphs',
      'high-school-functions-and-graphs -> high-school-calculus',
      'elementary-algebra -> trigonometry',
      'trigonometry -> undergraduate-calculus',
      'high-school-algebra -> high-school-linear-algebra',
      'elementary-functions-and-graphs -> high-school-probability-statistics',
      'elementary-algebra -> high-school-discrete-math',
      'high-school-discrete-math -> abstract-algebra',
      'high-school-geometry -> trigonometry',
      'high-school-geometry -> high-school-linear-algebra',
      'high-school-linear-algebra -> abstract-algebra',
    ]) {
      expect(derived, link).toContain(link);
    }
  });

  it('leaves few concepts without prerequisites', () => {
    const withIncoming = new Set(graph.edges.map((edge) => edge.to));
    const roots = concepts.filter((concept) => !withIncoming.has(concept.id));
    expect(roots.length).toBeLessThanOrEqual(6);
  });
});
