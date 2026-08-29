import type { ConceptGraph } from './types';

export const LEGACY_MATH_KNOWLEDGE_STORAGE_KEY = 'math-graph.knowledge-ratings.v1';
export function knowledgeStorageKey(graphId: string): string {
  return `knowledge-graph:${graphId}:knowledge-ratings:v1`;
}
export const KNOWLEDGE_RATINGS = ['aware', 'familiar', 'mastered'] as const;
export type KnowledgeRating = (typeof KNOWLEDGE_RATINGS)[number];
export type KnowledgeRatings = Record<string, KnowledgeRating>;

function isKnowledgeRating(value: unknown): value is KnowledgeRating {
  return typeof value === 'string' && KNOWLEDGE_RATINGS.includes(value as KnowledgeRating);
}

export function loadKnowledgeRatings(
  storage: Pick<Storage, 'getItem'>,
  graphId: string,
): KnowledgeRatings {
  try {
    const raw = storage.getItem(knowledgeStorageKey(graphId)) ??
      (graphId === 'math' ? storage.getItem(LEGACY_MATH_KNOWLEDGE_STORAGE_KEY) : null);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, KnowledgeRating] =>
        isKnowledgeRating(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function saveKnowledgeRatings(
  storage: Pick<Storage, 'setItem'>,
  ratings: KnowledgeRatings,
  graphId: string,
): void {
  storage.setItem(knowledgeStorageKey(graphId), JSON.stringify(ratings));
}

/** Leaf concept ids affected by evaluating a concept or recursive group. */
export function conceptIdsForTarget(graph: ConceptGraph, targetId: string): string[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of graph.nodes) {
    if (node.parent === undefined) continue;
    const ids = children.get(node.parent) ?? [];
    ids.push(node.id);
    children.set(node.parent, ids);
  }

  const result: string[] = [];
  const pending = [targetId];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node === undefined) continue;
    if (!node.isGroup) {
      result.push(id);
      continue;
    }
    pending.push(...(children.get(id) ?? []));
  }
  return result.sort();
}

export function applyKnowledgeRating(
  graph: ConceptGraph,
  ratings: KnowledgeRatings,
  targetId: string,
  rating: KnowledgeRating,
): KnowledgeRatings {
  const next = { ...ratings };
  for (const id of conceptIdsForTarget(graph, targetId)) next[id] = rating;
  return next;
}

export interface KnowledgeSummary {
  conceptCount: number;
  ratedCount: number;
  rating?: KnowledgeRating;
  mixed: boolean;
}

export function summarizeKnowledgeRating(
  graph: ConceptGraph,
  ratings: KnowledgeRatings,
  targetId: string,
): KnowledgeSummary {
  const ids = conceptIdsForTarget(graph, targetId);
  const values = ids.map((id) => ratings[id]).filter(isKnowledgeRating);
  const unique = new Set(values);
  return {
    conceptCount: ids.length,
    ratedCount: values.length,
    rating: values.length === ids.length && unique.size === 1 ? values[0] : undefined,
    mixed: unique.size > 1 || (values.length > 0 && values.length < ids.length),
  };
}
