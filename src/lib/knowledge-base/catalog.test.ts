import { describe, expect, it } from 'vitest';
import { loadKnowledgeGraphCatalog } from './catalog';

function source(id: string, topic: string, isDefault = false): string {
  return [
    'metadata:',
    `  id: ${id}`,
    `  topic: ${topic}`,
    ...(isDefault ? ['  default: true'] : []),
    'maturityLevels: []',
    'groups: []',
    'concepts: []',
    'dependencies: []',
  ].join('\n');
}

describe('knowledge graph catalog', () => {
  it('discovers and orders independent graphs with the default first', () => {
    const graphs = loadKnowledgeGraphCatalog({
      './physics.yaml': source('physics', 'Physics'),
      './math.yaml': source('math', 'Math', true),
    });
    expect(graphs.map((graph) => graph.metadata.id)).toEqual(['math', 'physics']);
  });

  it('rejects duplicate ids and multiple defaults', () => {
    expect(() => loadKnowledgeGraphCatalog({
      a: source('science', 'Science'),
      b: source('science', 'Other Science'),
    })).toThrow(/ids must be unique/);
    expect(() => loadKnowledgeGraphCatalog({
      a: source('math', 'Math', true),
      b: source('physics', 'Physics', true),
    })).toThrow(/Only one/);
  });
});
