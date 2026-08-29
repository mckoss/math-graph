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

/** Keep an entire node block within its assigned maturity band's y bounds. */
export function clampPointToMaturityBand(
  point: Point,
  band: Pick<MaturityBandRect, 'y1' | 'y2'>,
  nodeHeight: number,
  inset = 6,
): Point {
  const halfHeight = Math.max(0, nodeHeight) / 2;
  const minY = band.y1 + inset + halfHeight;
  const maxY = band.y2 - inset - halfHeight;
  return {
    x: point.x,
    y: minY <= maxY ? Math.max(minY, Math.min(maxY, point.y)) : (band.y1 + band.y2) / 2,
  };
}

export interface MaturityBandNodeBox {
  id: string;
  band: number;
  point: Point;
  width: number;
  height: number;
}

export function nodeBoxesOverlap(
  a: MaturityBandNodeBox,
  aPoint: Point,
  b: MaturityBandNodeBox,
  bPoint: Point,
  gap = 0,
): boolean {
  return (
    Math.abs(aPoint.x - bPoint.x) < (a.width + b.width) / 2 + gap &&
    Math.abs(aPoint.y - bPoint.y) < (a.height + b.height) / 2 + gap
  );
}

/** Move one block to the nearest band-safe position that does not overlap peers. */
export function constrainPointAgainstMaturityBandNodes(
  moving: MaturityBandNodeBox,
  desired: Point,
  others: readonly MaturityBandNodeBox[],
  band: MaturityBandRect,
  gap = 10,
): Point {
  let point = clampPointToMaturityBand(desired, band, moving.height, 7);
  const peers = others.filter((other) => other.band === moving.band && other.id !== moving.id);
  const maxPasses = Math.max(4, peers.length * 2);

  for (let pass = 0; pass < maxPasses; pass++) {
    let collision = false;
    for (const other of peers) {
      if (!nodeBoxesOverlap(moving, point, other, other.point, gap)) continue;
      collision = true;
      const dx = point.x - other.point.x;
      const dy = point.y - other.point.y;
      const pushX = (moving.width + other.width) / 2 + gap - Math.abs(dx);
      const pushY = (moving.height + other.height) / 2 + gap - Math.abs(dy);
      const yDirection = dy === 0 ? (moving.id < other.id ? -1 : 1) : Math.sign(dy);
      const yCandidate = clampPointToMaturityBand(
        { x: point.x, y: point.y + yDirection * pushY },
        band,
        moving.height,
        7,
      );
      if (!nodeBoxesOverlap(moving, yCandidate, other, other.point, gap)) {
        point = yCandidate;
      } else {
        const xDirection = dx === 0 ? (moving.id < other.id ? -1 : 1) : Math.sign(dx);
        point = { x: point.x + xDirection * pushX, y: point.y };
      }
    }
    if (!collision) break;
  }
  return point;
}

/**
 * Separate enlarged node blocks within each band. Prefer vertical separation
 * to reinforce progression; fall back to horizontal separation only when the
 * band boundary prevents enough vertical movement.
 */
export function separateMaturityBandNodes(
  nodes: readonly MaturityBandNodeBox[],
  bands: readonly MaturityBandRect[],
  gap = 10,
): Map<string, Point> {
  const positions = new Map(nodes.map((node) => [node.id, { ...node.point }]));
  const byBand = new Map<number, MaturityBandNodeBox[]>();
  for (const node of nodes) {
    const list = byBand.get(node.band) ?? [];
    list.push(node);
    byBand.set(node.band, list);
    const band = bands[node.band];
    if (band) positions.set(node.id, clampPointToMaturityBand(node.point, band, node.height, 7));
  }

  for (const [bandIndex, members] of byBand) {
    const band = bands[bandIndex];
    if (!band) continue;
    members.sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x || a.id.localeCompare(b.id));
    for (let pass = 0; pass < Math.max(20, members.length * members.length * 2); pass++) {
      let changed = false;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const a = members[i];
          const b = members[j];
          const pa = positions.get(a.id)!;
          const pb = positions.get(b.id)!;
          const needX = (a.width + b.width) / 2 + gap;
          const needY = (a.height + b.height) / 2 + gap;
          if (Math.abs(pb.x - pa.x) >= needX || Math.abs(pb.y - pa.y) >= needY) continue;

          const verticalOrder = pa.y === pb.y ? (pa.x <= pb.x ? -1 : 1) : pa.y < pb.y ? -1 : 1;
          const verticalPush = (needY - Math.abs(pb.y - pa.y)) / 2;
          const nextA = clampPointToMaturityBand(
            { x: pa.x, y: pa.y + verticalOrder * verticalPush },
            band,
            a.height,
            7,
          );
          const nextB = clampPointToMaturityBand(
            { x: pb.x, y: pb.y - verticalOrder * verticalPush },
            band,
            b.height,
            7,
          );
          positions.set(a.id, nextA);
          positions.set(b.id, nextB);

          if (Math.abs(nextB.y - nextA.y) < needY) {
            const horizontalOrder = nextA.x <= nextB.x ? -1 : 1;
            const horizontalPush = (needX - Math.abs(nextB.x - nextA.x)) / 2;
            nextA.x += horizontalOrder * horizontalPush;
            nextB.x -= horizontalOrder * horizontalPush;
          }
          changed = true;
        }
      }
      if (!changed) break;
    }
  }
  return positions;
}

/**
 * Pack a dense graph into centered rows no wider than the current viewport.
 * Ordering follows the incoming dagre positions, while maturity bands retain
 * their independent vertical regions.
 */
export function packMaturityBandNodes(
  nodes: readonly MaturityBandNodeBox[],
  bands: readonly MaturityBandRect[],
  maxWidth: number,
  gap = 12,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const byBand = new Map<number, MaturityBandNodeBox[]>();
  const xs = nodes.map((node) => node.point.x);
  const centerX = xs.length === 0 ? 0 : (Math.min(...xs) + Math.max(...xs)) / 2;

  for (const node of nodes) {
    const list = byBand.get(node.band) ?? [];
    list.push(node);
    byBand.set(node.band, list);
  }

  for (const [bandIndex, members] of byBand) {
    const band = bands[bandIndex];
    if (!band) continue;
    members.sort((a, b) => a.point.y - b.point.y || a.point.x - b.point.x || a.id.localeCompare(b.id));
    const cellWidth = Math.max(...members.map((node) => node.width)) + gap;
    const cellHeight = Math.max(...members.map((node) => node.height)) + gap;
    const columns = Math.max(1, Math.floor((Math.max(cellWidth, maxWidth) + gap) / cellWidth));
    const rows = Math.ceil(members.length / columns);
    const contentHeight = rows * cellHeight - gap;
    const firstCenterY = (band.y1 + band.y2 - contentHeight) / 2 + (cellHeight - gap) / 2;

    for (let row = 0; row < rows; row++) {
      const rowMembers = members.slice(row * columns, (row + 1) * columns);
      const rowWidth = rowMembers.length * cellWidth - gap;
      const firstCenterX = centerX - rowWidth / 2 + (cellWidth - gap) / 2;
      rowMembers.forEach((node, column) => {
        positions.set(
          node.id,
          clampPointToMaturityBand(
            {
              x: firstCenterX + column * cellWidth,
              y: firstCenterY + row * cellHeight,
            },
            band,
            node.height,
            7,
          ),
        );
      });
    }
  }
  return positions;
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
  requestedWeights?: readonly number[],
): MaturityBandLayout {
  const output = new Map<string, Point>();
  const count = Math.max(1, bandCount);
  const members = Array.from({ length: count }, () => new Array<{ id: string; point: Point }>());

  for (const [id, point] of positions) {
    const requestedBand = assignments.get(id) ?? 0;
    const band = Math.max(0, Math.min(count - 1, requestedBand));
    members[band].push({ id, point });
  }

  // Empty levels stay visible as narrow colored bands without consuming the
  // same space as levels containing nodes.
  const weights = members.map((bandMembers, band) => {
    const requested = requestedWeights?.[band];
    return requested !== undefined && Number.isFinite(requested) && requested > 0
      ? requested
      : bandMembers.length === 0 ? 0.35 : Math.sqrt(bandMembers.length);
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = top;
  const bandRects = members.map((bandMembers, band) => {
    const bandHeight = Math.max(1, totalHeight) * (weights[band] / weightTotal);
    const y1 = cursor;
    const y2 = y1 + bandHeight;
    cursor = y2;
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
