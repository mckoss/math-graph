import type { ConceptEdge } from '../types';
import type { Point } from './layout';

export type VerticalSeparation = number | ((edge: ConceptEdge) => number);

function separationFor(edge: ConceptEdge, separation: VerticalSeparation): number {
  const value = typeof separation === 'function' ? separation(edge) : separation;
  return Math.max(0, value);
}

/**
 * Push dependents downward until every visible prerequisite edge is
 * top-to-bottom with the requested clearance. The visible dependency graph is
 * expected to be acyclic, matching the canonical knowledge graph.
 */
export function enforceVerticalDependencyOrder(
  positions: ReadonlyMap<string, Point>,
  edges: readonly ConceptEdge[],
  separation: VerticalSeparation = 1,
): Map<string, Point> {
  const output = new Map([...positions].map(([id, point]) => [id, { ...point }]));
  for (let pass = 0; pass < output.size; pass++) {
    let changed = false;
    for (const edge of edges) {
      const prerequisite = output.get(edge.from);
      const dependent = output.get(edge.to);
      const minimumY = prerequisite === undefined ? -Infinity : prerequisite.y + separationFor(edge, separation);
      if (prerequisite === undefined || dependent === undefined || dependent.y >= minimumY) {
        continue;
      }
      output.set(edge.to, { x: dependent.x, y: minimumY });
      changed = true;
    }
    if (!changed) break;
  }
  return output;
}

/** Clamp one directly manipulated block below all visible prerequisites. */
export function constrainPointToVerticalDependencyOrder(
  id: string,
  desired: Point,
  positions: ReadonlyMap<string, Point>,
  edges: readonly ConceptEdge[],
  separation: VerticalSeparation = 1,
): Point {
  let minimumY = -Infinity;
  for (const edge of edges) {
    const clearance = separationFor(edge, separation);
    if (edge.to === id) {
      minimumY = Math.max(minimumY, (positions.get(edge.from)?.y ?? -Infinity) + clearance);
    }
  }
  return {
    x: desired.x,
    y: Math.max(minimumY, desired.y),
  };
}

export function countVerticalDependencyOrderViolations(
  positions: ReadonlyMap<string, Point>,
  edges: readonly ConceptEdge[],
  separation: VerticalSeparation = 1,
  tolerance = 0.01,
): number {
  return edges.filter((edge) => {
    const prerequisite = positions.get(edge.from);
    const dependent = positions.get(edge.to);
    return prerequisite !== undefined && dependent !== undefined &&
      dependent.y + tolerance < prerequisite.y + separationFor(edge, separation);
  }).length;
}
