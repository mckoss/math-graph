import type { MaturityBandNodeBox, Point } from './maturity-bands';

/**
 * Compact horizontal ranks around one centerline without changing the
 * left-to-right order chosen by the dependency-aware layout. Nodes whose
 * vertical rectangles overlap are treated as one rank; vertically separated
 * nodes may share the centerline.
 */
export function compactRanksTowardCenterline(
  nodes: readonly MaturityBandNodeBox[],
  centerX: number,
  gap = 14,
): Map<string, Point> {
  const positions = new Map(nodes.map((node) => [node.id, { ...node.point }]));
  const byBand = new Map<number, MaturityBandNodeBox[]>();
  for (const node of nodes) {
    const members = byBand.get(node.band) ?? [];
    members.push(node);
    byBand.set(node.band, members);
  }

  for (const members of byBand.values()) {
    const ordered = [...members].sort(
      (a, b) => a.point.y - b.point.y || a.point.x - b.point.x || a.id.localeCompare(b.id),
    );
    const rows: MaturityBandNodeBox[][] = [];
    for (const node of ordered) {
      const row = rows.at(-1);
      if (row === undefined) {
        rows.push([node]);
        continue;
      }
      const overlapsRow = row.some(
        (member) =>
          Math.abs(member.point.y - node.point.y) < (member.height + node.height) / 2,
      );
      if (overlapsRow) row.push(node);
      else rows.push([node]);
    }

    for (const row of rows) {
      row.sort((a, b) => a.point.x - b.point.x || a.id.localeCompare(b.id));
      const width = row.reduce((sum, node) => sum + node.width, 0) + gap * (row.length - 1);
      let cursor = centerX - width / 2;
      for (const node of row) {
        positions.set(node.id, { x: cursor + node.width / 2, y: node.point.y });
        cursor += node.width + gap;
      }
    }
  }

  return positions;
}
