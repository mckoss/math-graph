/**
 * Pure logic for the multilevel (expand/collapse) view of a ConceptGraph.
 *
 * The visualization renders a hierarchy-preserving "visible" graph derived
 * from the full graph plus a set of expanded category ids:
 *
 *   visible nodes = every visible group (expanded or collapsed)
 *                 + direct children of every expanded group
 *                 + recursively visible descendants of expanded subgroups
 *
 * Every edge of the full graph is remapped to the visible *representative* of
 * its endpoints (a node hidden inside a collapsed group is represented by the
 * outermost collapsed ancestor group). Self-loops and duplicate remapped edges
 * are dropped.
 */

import type { ConceptEdge, ConceptGraph, GraphNode } from '../types';

export interface VisibleGraph {
  nodes: GraphNode[];
  /** Remapped, deduplicated edges between visible nodes. */
  edges: ConceptEdge[];
}

/** Index of nodes by id. */
export function nodesById(graph: ConceptGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

/** Map from a group id to its direct children (in graph order). */
export function childrenByParent(graph: ConceptGraph): Map<string, GraphNode[]> {
  const map = new Map<string, GraphNode[]>();
  for (const n of graph.nodes) {
    if (n.parent === undefined) continue;
    const list = map.get(n.parent);
    if (list) list.push(n);
    else map.set(n.parent, [n]);
  }
  return map;
}

/** Ancestor chain of a node, from its immediate parent up to the root. */
export function ancestorsOf(byId: Map<string, GraphNode>, id: string): string[] {
  const out: string[] = [];
  let cur = byId.get(id)?.parent;
  while (cur !== undefined && !out.includes(cur)) {
    out.push(cur);
    cur = byId.get(cur)?.parent;
  }
  return out;
}

/**
 * The visible node that stands in for `id` under the given expansion state:
 * - the outermost collapsed group ancestor, if any (walking down from the
 *   root of the parent chain);
 * - otherwise the node itself. Expanded groups remain visible as compound
 *   parent containers rather than being replaced by their children.
 */
export function representativeOf(
  byId: Map<string, GraphNode>,
  expanded: ReadonlySet<string>,
  id: string,
): string | null {
  const node = byId.get(id);
  if (!node) return null;
  // Chain from root-most ancestor down to the node itself.
  const chain = [...ancestorsOf(byId, id).reverse(), id];
  for (const cid of chain) {
    const c = byId.get(cid);
    if (c?.isGroup && !expanded.has(cid)) return cid;
  }
  return id;
}

/** Number of non-group descendants of a group (concepts it contains). */
export function conceptCountOf(children: Map<string, GraphNode[]>, id: string): number {
  let count = 0;
  for (const child of children.get(id) ?? []) {
    count += child.isGroup ? conceptCountOf(children, child.id) : 1;
  }
  return count;
}

/** All descendant ids of a group (both groups and concepts). */
export function descendantsOf(children: Map<string, GraphNode[]>, id: string): string[] {
  const out: string[] = [];
  for (const child of children.get(id) ?? []) {
    out.push(child.id);
    if (child.isGroup) out.push(...descendantsOf(children, child.id));
  }
  return out;
}

/** Compute the visible aggregated graph for a given set of expanded category ids. */
export function computeVisible(graph: ConceptGraph, expanded: ReadonlySet<string>): VisibleGraph {
  const byId = nodesById(graph);

  const nodes = graph.nodes.filter((n) => representativeOf(byId, expanded, n.id) === n.id);

  const edges: ConceptEdge[] = [];
  const byKey = new Map<string, ConceptEdge>();
  for (const e of graph.edges) {
    const from = representativeOf(byId, expanded, e.from);
    const to = representativeOf(byId, expanded, e.to);
    if (from === null || to === null || from === to) continue;
    const key = `${from}\0${to}`;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      if (e.historicalOrderMismatch) existing.historicalOrderMismatch = true;
      continue;
    }
    const visibleEdge: ConceptEdge = {
      from,
      to,
      ...(e.historicalOrderMismatch ? { historicalOrderMismatch: true } : {}),
    };
    byKey.set(key, visibleEdge);
    edges.push(visibleEdge);
  }

  return { nodes, edges };
}
