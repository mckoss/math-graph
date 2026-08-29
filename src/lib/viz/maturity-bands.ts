/** Pure helpers for arranging graph nodes into configured maturity bands. */

import type { ConceptGraph, GraphNode } from '../types';
import { childrenByParent, descendantsOf, nodesById } from './graph-model';
import { orderedMaturityLevels } from './colors';

export interface Point {
  x: number;
  y: number;
}

/**
 * Assign every graph node to a maturity band. Concepts use their explicit
 * level. Groups use the median level of their classified descendants so
 * their placement remains stable while collapsed.
 */
export function assignMaturityBands(graph: ConceptGraph): Map<string, number> {
  const byId = nodesById(graph);
  const children = childrenByParent(graph);
  const assignments = new Map<string, number>();
  const maturityIndex = new Map(
    orderedMaturityLevels(graph.maturityLevels).map((level, index) => [level.id, index]),
  );

  const resolve = (node: GraphNode, seen: Set<string>): number => {
    const cached = assignments.get(node.id);
    if (cached !== undefined) return cached;

    let band =
      node.maturityLevel === undefined ? undefined : maturityIndex.get(node.maturityLevel);

    if (band === undefined && node.isGroup) {
      const descendantBands = descendantsOf(children, node.id)
        .map((id) => byId.get(id))
        .filter(
          (descendant): descendant is GraphNode =>
            descendant !== undefined &&
            !descendant.isGroup &&
            descendant.maturityLevel !== undefined,
        )
        .map((descendant) => maturityIndex.get(descendant.maturityLevel!) ?? 0)
        .sort((a, b) => a - b);

      if (descendantBands.length > 0) {
        band = descendantBands[Math.floor((descendantBands.length - 1) / 2)];
      }
    }

    if (band === undefined && node.parent !== undefined && !seen.has(node.parent)) {
      const parent = byId.get(node.parent);
      if (parent !== undefined) {
        seen.add(node.id);
        band = resolve(parent, seen);
      }
    }

    band ??= 0;
    assignments.set(node.id, band);
    return band;
  };

  for (const node of graph.nodes) resolve(node, new Set());
  return assignments;
}

export interface MaturityBandRect {
  band: number;
  y1: number;
  y2: number;
  count: number;
}

export interface MaturityBandLayout {
  positions: Map<string, Point>;
  bandRects: MaturityBandRect[];
}

/**
 * Remap vertical positions into equal, top-to-bottom maturity bands. Every
 * configured band receives a rectangle even when it has no nodes. Within a
 * band, the input ordering is preserved to retain dagre's crossing reduction.
 */
export function placeInMaturityBands(
  positions: ReadonlyMap<string, Point>,
  assignments: ReadonlyMap<string, number>,
  top: number,
  totalHeight: number,
  bandCount: number,
): MaturityBandLayout {
  const output = new Map<string, Point>();
  const count = Math.max(1, bandCount);
  const members = Array.from({ length: count }, () => new Array<{ id: string; point: Point }>());

  for (const [id, point] of positions) {
    const requestedBand = assignments.get(id) ?? 0;
    const band = Math.max(0, Math.min(count - 1, requestedBand));
    members[band].push({ id, point });
  }

  const bandHeight = Math.max(1, totalHeight) / count;
  const bandRects = members.map((bandMembers, band) => {
    const y1 = top + band * bandHeight;
    const y2 = y1 + bandHeight;
    const sourceYs = bandMembers.map(({ point }) => point.y);
    const minY = sourceYs.length > 0 ? Math.min(...sourceYs) : 0;
    const maxY = sourceYs.length > 0 ? Math.max(...sourceYs) : 0;
    const padding = Math.min(bandHeight * 0.2, 48);
    const innerTop = y1 + padding;
    const innerHeight = Math.max(1, bandHeight - 2 * padding);

    for (const member of bandMembers) {
      const fraction = maxY > minY ? (member.point.y - minY) / (maxY - minY) : 0.5;
      output.set(member.id, {
        x: member.point.x,
        y: innerTop + fraction * innerHeight,
      });
    }

    return { band, y1, y2, count: bandMembers.length };
  });

  return { positions: output, bandRects };
}
