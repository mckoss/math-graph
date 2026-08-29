import type { ConceptGraph } from '../types';
import { loadKnowledgeBase } from './load';

/** Load independently authored YAML graphs discovered by the application. */
export function loadKnowledgeGraphCatalog(sources: Readonly<Record<string, string>>): ConceptGraph[] {
  const graphs = Object.entries(sources).map(([path, source]) => {
    const graph = loadKnowledgeBase(source);
    if (graph.metadata.id === 'unknown') throw new Error(`Dataset ${path} is missing metadata`);
    return graph;
  });
  if (graphs.length === 0) throw new Error('No knowledge graph datasets were discovered');

  const ids = graphs.map((graph) => graph.metadata.id);
  if (new Set(ids).size !== ids.length) throw new Error('Knowledge graph dataset ids must be unique');
  if (graphs.filter((graph) => graph.metadata.default).length > 1) {
    throw new Error('Only one knowledge graph dataset may be the default');
  }
  return graphs.sort((left, right) =>
    Number(Boolean(right.metadata.default)) - Number(Boolean(left.metadata.default)) ||
    left.metadata.topic.localeCompare(right.metadata.topic),
  );
}
