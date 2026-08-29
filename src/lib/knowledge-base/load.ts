/** Load the YAML knowledge base and mechanically normalize it for the graph UI. */

import { parse } from 'yaml';

import type {
  ConceptEdge,
  ConceptGraph,
  ConceptHistory,
  GraphNode,
  MaturityLevel,
} from '../types';

interface SourceConcept {
  id: string;
  label: string;
  group: string;
  wikipedia?: string;
  maturityLevel: string;
  description?: string;
  history?: ConceptHistory;
}

interface SourceGroup {
  id: string;
  label: string;
  wikipedia?: string;
  description?: string;
  groups?: SourceGroup[];
}

interface KnowledgeBaseDocument {
  maturityLevels?: MaturityLevel[];
  groups?: SourceGroup[];
  concepts?: SourceConcept[];
  dependencies?: string[];
}

function conceptNode(source: SourceConcept): GraphNode {
  const { group, ...fields } = source;
  return {
    ...fields,
    parent: group,
    isGroup: false,
  };
}

/**
 * Deserialize YAML using the standard library parser, then perform only the
 * mechanical nesting/edge-chain normalization required by ConceptGraph.
 * Structural and graph validation live in the knowledge-base test suite.
 */
export function loadKnowledgeBase(source: string): ConceptGraph {
  const document = parse(source, { uniqueKeys: true }) as KnowledgeBaseDocument;
  const nodes: GraphNode[] = [];

  const addGroup = (group: SourceGroup, parent?: string): void => {
    const { groups = [], ...fields } = group;
    nodes.push({ ...fields, ...(parent === undefined ? {} : { parent }), isGroup: true });
    for (const child of groups) addGroup(child, group.id);
  };
  for (const group of document.groups ?? []) {
    addGroup(group);
  }
  nodes.push(...(document.concepts ?? []).map(conceptNode));

  const edges: ConceptEdge[] = [];
  const seen = new Set<string>();
  for (const chain of document.dependencies ?? []) {
    const ids = chain.split('->').map((id) => id.trim());
    for (let index = 0; index + 1 < ids.length; index += 1) {
      const edge = { from: ids[index], to: ids[index + 1] };
      const key = `${edge.from}\0${edge.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }

  return { maturityLevels: document.maturityLevels ?? [], nodes, edges };
}
