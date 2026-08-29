import { describe, expect, it } from 'vitest';

import { parseCurriculum } from './parser';
import type { ConceptNode } from '../types';
import curriculumRaw from '../../data/curriculum.yaml?raw';

function nodeById(nodes: ConceptNode[], id: string): ConceptNode {
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`node "${id}" not found`);
  return node;
}

describe('parseCurriculum: happy path', () => {
  const source = [
    '# A small sample graph',
    'categories:',
    '  - id: basics',
    '    label: "The Basics"',
    '    wikipedia: Mathematics',
    '    description: "Elementary ideas."',
    '    concepts:',
    '      - id: counting',
    '        label: Counting',
    '        wikipedia: Counting',
    '        stage: elementary',
    '        description: Learning to count.',
    '      - id: addition',
    '        label: Addition',
    '',
    'concepts:',
    '  - id: algebra-basics',
    '    label: Algebra',
    '    stage: middle',
    '',
    'edges:',
    '  - counting -> addition',
    '  - addition -> algebra-basics',
  ].join('\n');

  const { graph, errors } = parseCurriculum(source);

  it('reports no errors', () => {
    expect(errors).toEqual([]);
  });

  it('builds category and concept nodes', () => {
    expect(graph.nodes.map((n) => n.id)).toEqual([
      'basics',
      'counting',
      'addition',
      'algebra-basics',
    ]);
    const basics = nodeById(graph.nodes, 'basics');
    expect(basics).toMatchObject({
      label: 'The Basics',
      isCategory: true,
      wikipedia: 'Mathematics',
      description: 'Elementary ideas.',
    });
    expect(basics.parent).toBeUndefined();
  });

  it('assigns parent to concepts inside a category; top-level concepts have none', () => {
    expect(nodeById(graph.nodes, 'counting').parent).toBe('basics');
    expect(nodeById(graph.nodes, 'addition').parent).toBe('basics');
    expect(nodeById(graph.nodes, 'algebra-basics').parent).toBeUndefined();
  });

  it('reads all optional fields', () => {
    expect(nodeById(graph.nodes, 'counting')).toMatchObject({
      label: 'Counting',
      wikipedia: 'Counting',
      stage: 'elementary',
      description: 'Learning to count.',
      isCategory: false,
    });
    // Optional fields absent: undefined, not present as other values.
    const addition = nodeById(graph.nodes, 'addition');
    expect(addition.wikipedia).toBeUndefined();
    expect(addition.stage).toBeUndefined();
  });

  it('collects the edges', () => {
    expect(graph.edges).toEqual([
      { from: 'counting', to: 'addition' },
      { from: 'addition', to: 'algebra-basics' },
    ]);
  });
});

describe('parseCurriculum: edges', () => {
  const concepts = (ids: string[]) =>
    'concepts:\n' + ids.map((id) => `  - id: ${id}\n    label: ${id.toUpperCase()}\n`).join('');

  it('expands chains a -> b -> c into pairs', () => {
    const { graph, errors } = parseCurriculum(
      concepts(['a', 'b', 'c']) + 'edges:\n  - a -> b -> c\n'
    );
    expect(errors).toEqual([]);
    expect(graph.edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);
  });

  it('deduplicates repeated edges silently', () => {
    const { graph, errors } = parseCurriculum(
      concepts(['a', 'b']) + 'edges:\n  - a -> b\n  - a -> b\n'
    );
    expect(errors).toEqual([]);
    expect(graph.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('reports edges referencing unknown ids (with the edge line) and keeps valid edges', () => {
    const { graph, errors } = parseCurriculum(
      concepts(['a', 'b']) + 'edges:\n  - a -> b\n  - a -> ghost\n  - phantom -> b\n'
    );
    expect(errors).toEqual([
      { line: 8, message: 'edge references unknown id "ghost"' },
      { line: 9, message: 'edge references unknown id "phantom"' },
    ]);
    expect(graph.edges).toEqual([{ from: 'a', to: 'b' }]);
  });

  it('reports an edge without an arrow', () => {
    const { errors } = parseCurriculum(concepts(['a']) + 'edges:\n  - a\n');
    expect(errors).toEqual([{ line: 5, message: 'edge "a" must contain "->"' }]);
  });

  it('reports a non-string edge entry', () => {
    const { errors } = parseCurriculum(concepts(['a']) + 'edges:\n  - 42\n');
    expect(errors).toEqual([{ line: 5, message: 'each edge must be a string like "a -> b"' }]);
  });

  it('reports malformed ids inside an edge string', () => {
    const { graph, errors } = parseCurriculum(
      concepts(['a', 'b']) + 'edges:\n  - a -> Not Kebab\n'
    );
    expect(errors).toEqual([
      { line: 7, message: 'invalid id "Not Kebab" in edge "a -> Not Kebab"' },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it('reports self-dependencies', () => {
    const { graph, errors } = parseCurriculum(concepts(['a']) + 'edges:\n  - a -> a\n');
    expect(errors).toEqual([{ line: 5, message: '"a" cannot depend on itself' }]);
    expect(graph.edges).toEqual([]);
  });
});

describe('parseCurriculum: semantic errors', () => {
  it('reports duplicate ids (line of the offending id) and keeps the first definition', () => {
    const { graph, errors } = parseCurriculum(
      [
        'concepts:',
        '  - id: a',
        '    label: First',
        '  - id: b',
        '    label: B',
        '  - id: a',
        '    label: Second',
      ].join('\n')
    );
    expect(errors).toEqual([{ line: 6, message: 'duplicate id "a"' }]);
    expect(graph.nodes).toHaveLength(2);
    expect(nodeById(graph.nodes, 'a').label).toBe('First');
  });

  it('reports unknown stage values (with the stage line) but keeps the node', () => {
    const { graph, errors } = parseCurriculum(
      'concepts:\n  - id: a\n    label: A\n    wikipedia: Number\n    stage: kindergarten\n'
    );
    expect(errors).toEqual([
      {
        line: 5,
        message:
          'unknown stage "kindergarten" on "a" ' +
          '(expected elementary | middle | high-school | undergraduate)',
      },
    ]);
    const a = nodeById(graph.nodes, 'a');
    expect(a.stage).toBeUndefined();
    expect(a.wikipedia).toBe('Number');
  });

  it('reports unknown keys (typo detection) but keeps the node', () => {
    const { graph, errors } = parseCurriculum(
      'concepts:\n  - id: a\n    label: A\n    wikpedia: Number\n'
    );
    expect(errors).toEqual([
      {
        line: 4,
        message:
          'unknown key "wikpedia" in concept (expected id, label, wikipedia, stage, description)',
      },
    ]);
    expect(nodeById(graph.nodes, 'a').wikipedia).toBeUndefined();
  });

  it('rejects "concepts" nested inside a concept (categories nest one level only)', () => {
    const { errors } = parseCurriculum(
      [
        'categories:',
        '  - id: cat',
        '    label: Cat',
        '    concepts:',
        '      - id: a',
        '        label: A',
        '        concepts:',
        '          - id: b',
        '            label: B',
      ].join('\n')
    );
    expect(errors).toEqual([
      {
        line: 7,
        message:
          'unknown key "concepts" in concept (expected id, label, wikipedia, stage, description)',
      },
    ]);
  });

  it('reports a missing id', () => {
    const { graph, errors } = parseCurriculum('concepts:\n  - label: Mystery\n');
    expect(errors).toEqual([{ line: 2, message: 'concept is missing required key "id"' }]);
    expect(graph.nodes).toEqual([]);
  });

  it('reports a missing label but keeps the node (label falls back to id)', () => {
    const { graph, errors } = parseCurriculum('concepts:\n  - id: a\n');
    expect(errors).toEqual([
      { line: 2, message: 'concept "a" is missing required key "label"' },
    ]);
    expect(nodeById(graph.nodes, 'a').label).toBe('a');
  });

  it('reports a non-kebab-case id', () => {
    const { errors } = parseCurriculum('concepts:\n  - id: NotKebab\n    label: X\n');
    expect(errors).toEqual([
      {
        line: 2,
        message:
          'id "NotKebab" is not kebab-case (lowercase letters/digits separated by hyphens)',
      },
    ]);
  });

  it('reports non-string field values', () => {
    const { errors } = parseCurriculum('concepts:\n  - id: a\n    label: 42\n');
    expect(errors).toEqual([{ line: 3, message: '"label" must be a string' }]);
  });

  it('reports unknown top-level keys', () => {
    const { errors } = parseCurriculum('nodes:\n  - id: a\n');
    expect(errors).toEqual([
      { line: 1, message: 'unknown top-level key "nodes" (expected categories, concepts, edges)' },
    ]);
  });

  it('collects multiple errors in one pass, sorted by line', () => {
    const { errors } = parseCurriculum(
      [
        'concepts:',
        '  - id: a',
        '    label: A',
        '    stage: bogus', // line 4: unknown stage
        '  - id: a', // line 5: duplicate id
        '    label: Again',
        'edges:',
        '  - a -> nowhere', // line 8: unknown id
      ].join('\n')
    );
    expect(errors.map((e) => e.line)).toEqual([4, 5, 8]);
  });
});

describe('parseCurriculum: YAML syntax errors', () => {
  it('reports YAML parse errors with 1-based line numbers and never throws', () => {
    const source = 'concepts:\n  - id: a\n    label: A\n   bad indent here\n';
    const { errors } = parseCurriculum(source);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toMatch(/^YAML syntax error: /);
    expect(errors[0].line).toBe(4);
  });

  it('still returns the valid portion of the graph alongside syntax errors', () => {
    // The unclosed flow sequence is a syntax error; the concepts above it parse.
    const source = 'concepts:\n  - id: a\n    label: A\nedges: [1, 2\n';
    const { graph, errors } = parseCurriculum(source);
    expect(errors.some((e) => e.message.startsWith('YAML syntax error:'))).toBe(true);
    expect(nodeById(graph.nodes, 'a').label).toBe('A');
  });

  it('accepts an empty document', () => {
    expect(parseCurriculum('')).toEqual({ graph: { nodes: [], edges: [] }, errors: [] });
    expect(parseCurriculum('# only comments\n')).toEqual({
      graph: { nodes: [], edges: [] },
      errors: [],
    });
  });

  it('rejects a non-mapping top level', () => {
    const { errors } = parseCurriculum('- just\n- a list\n');
    expect(errors).toEqual([
      {
        line: 1,
        message:
          'top level must be a mapping with keys "categories", "concepts", and/or "edges"',
      },
    ]);
  });
});

describe('parseCurriculum: cycle detection', () => {
  const concepts = (ids: string[]) =>
    'concepts:\n' + ids.map((id) => `  - id: ${id}\n    label: ${id.toUpperCase()}\n`).join('');

  it('reports a dependency cycle with the line of the closing edge', () => {
    const { errors } = parseCurriculum(
      concepts(['a', 'b', 'c']) + 'edges:\n  - a -> b\n  - b -> c\n  - c -> a\n'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(11);
    expect(errors[0].message).toBe('dependency cycle: a -> b -> c -> a');
  });

  it('reports a cycle written as a single chain', () => {
    const { errors } = parseCurriculum(concepts(['a', 'b']) + 'edges:\n  - a -> b -> a\n');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('dependency cycle:');
  });

  it('accepts a diamond (shared prerequisites are not a cycle)', () => {
    const { errors } = parseCurriculum(
      concepts(['a', 'b', 'c', 'd']) + 'edges:\n  - a -> b -> d\n  - a -> c -> d\n'
    );
    expect(errors).toEqual([]);
  });
});

describe('curriculum.yaml', () => {
  const { graph, errors } = parseCurriculum(curriculumRaw);
  const categories = graph.nodes.filter((n) => n.isCategory);
  const concepts = graph.nodes.filter((n) => !n.isCategory);

  it('parses with zero errors', () => {
    expect(errors).toEqual([]);
  });

  it('has a substantial graph', () => {
    expect(categories.length).toBeGreaterThanOrEqual(8);
    expect(categories.length).toBeLessThanOrEqual(12);
    expect(concepts.length).toBeGreaterThanOrEqual(60);
    expect(concepts.length).toBeLessThanOrEqual(100);
    expect(graph.edges.length).toBeGreaterThanOrEqual(100);
  });

  it('gives every concept a parent category, wikipedia title, stage, and description', () => {
    const categoryIds = new Set(categories.map((c) => c.id));
    for (const node of concepts) {
      expect(node.parent, node.id).toBeDefined();
      expect(categoryIds.has(node.parent!), node.id).toBe(true);
      expect(node.wikipedia, node.id).toBeTruthy();
      expect(node.stage, node.id).toBeTruthy();
      expect(node.description, node.id).toBeTruthy();
    }
  });

  it('links categories to each other (edges among category nodes)', () => {
    const categoryIds = new Set(categories.map((c) => c.id));
    const categoryEdges = graph.edges.filter(
      (e) => categoryIds.has(e.from) && categoryIds.has(e.to)
    );
    expect(categoryEdges.length).toBeGreaterThanOrEqual(8);
    expect(categoryEdges).toContainEqual({ from: 'trigonometry', to: 'calculus' });
  });

  it('leaves few orphan concepts (almost every concept has a prerequisite)', () => {
    const withIncoming = new Set(graph.edges.map((e) => e.to));
    const roots = concepts.filter((n) => !withIncoming.has(n.id));
    // Genuine starting points (counting, angles, sets, ...) are allowed.
    expect(roots.length).toBeLessThanOrEqual(6);
  });
});
