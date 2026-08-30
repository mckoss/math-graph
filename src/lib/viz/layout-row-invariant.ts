export interface LayoutRowNode {
  id: string;
  band: string;
  x: number;
  y: number;
  width: number;
}

export interface LayoutRowEdge {
  from: string;
  to: string;
}

export interface LayoutRowViolation {
  id: string;
  actualRow: number;
  earliestFeasibleRow: number;
  reason: 'dependency-depth' | 'unnecessary-overflow';
}

export interface LayoutRowAnalysis {
  rows: ReadonlyMap<string, number>;
  violations: readonly LayoutRowViolation[];
}

/**
 * Verify that each maturity band uses the earliest dependency-safe row that
 * still has horizontal room. Nodes sharing a row may be rearranged, so row
 * capacity is based on their total widths rather than their current x order.
 */
export function analyzeLayoutRows(
  nodes: readonly LayoutRowNode[],
  edges: readonly LayoutRowEdge[],
  availableWidth: number,
  gap = 12,
  yTolerance = 1,
): LayoutRowAnalysis {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rows = new Map<string, number>();
  const rowMembers = new Map<string, LayoutRowNode[][]>();

  for (const band of new Set(nodes.map((node) => node.band))) {
    const members = nodes
      .filter((node) => node.band === band)
      .sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
    const bandRows: LayoutRowNode[][] = [];
    for (const node of members) {
      const current = bandRows.at(-1);
      if (current === undefined || Math.abs(current[0].y - node.y) > yTolerance) {
        bandRows.push([node]);
      } else {
        current.push(node);
      }
      rows.set(node.id, bandRows.length - 1);
    }
    rowMembers.set(band, bandRows);
  }

  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined || from.band !== to.band) continue;
    const list = parents.get(to.id) ?? [];
    list.push(from.id);
    parents.set(to.id, list);
  }

  const violations: LayoutRowViolation[] = [];
  for (const node of nodes) {
    const actualRow = rows.get(node.id) ?? 0;
    const sameBandParents = parents.get(node.id) ?? [];
    const minimumRow = sameBandParents.length === 0
      ? 0
      : 1 + Math.max(...sameBandParents.map((id) => rows.get(id) ?? 0));
    if (actualRow < minimumRow) {
      violations.push({
        id: node.id,
        actualRow,
        earliestFeasibleRow: minimumRow,
        reason: 'dependency-depth',
      });
      continue;
    }

    const bandRows = rowMembers.get(node.band) ?? [];
    for (let candidate = minimumRow; candidate < actualRow; candidate++) {
      const occupants = bandRows[candidate] ?? [];
      const occupiedWidth = occupants.reduce((sum, occupant) => sum + occupant.width, 0) +
        Math.max(0, occupants.length - 1) * gap;
      const addedWidth = node.width + (occupants.length === 0 ? 0 : gap);
      if (occupiedWidth + addedWidth <= availableWidth + 1e-6) {
        violations.push({
          id: node.id,
          actualRow,
          earliestFeasibleRow: candidate,
          reason: 'unnecessary-overflow',
        });
        break;
      }
    }
  }

  return { rows, violations };
}

export function rectangleOverlapCount(
  nodes: readonly LayoutRowNode[],
  heights: ReadonlyMap<string, number>,
): number {
  let count = 0;
  for (let left = 0; left < nodes.length; left++) {
    for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left];
      const b = nodes[right];
      if (
        Math.abs(a.x - b.x) < (a.width + b.width) / 2 &&
        Math.abs(a.y - b.y) < ((heights.get(a.id) ?? 0) + (heights.get(b.id) ?? 0)) / 2
      ) count++;
    }
  }
  return count;
}
