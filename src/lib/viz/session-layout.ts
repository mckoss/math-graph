import type { MaturityBandNodeBox, MaturityBandRect, Point } from './maturity-bands';

export interface SavedLocalPosition {
  dx: number;
  bandFraction: number;
}

export interface ParentLocalPosition {
  dx: number;
  dy: number;
}

/** Capture authoritative coordinates relative to an immediate parent anchor. */
export function captureParentLocalLayout(
  anchor: Point,
  nodes: readonly Pick<MaturityBandNodeBox, 'id' | 'point'>[],
): Map<string, ParentLocalPosition> {
  return new Map(nodes.map((node) => [node.id, {
    dx: node.point.x - anchor.x,
    dy: node.point.y - anchor.y,
  }]));
}

/** Compose parent world translation with saved immediate-child coordinates. */
export function restoreParentLocalLayout(
  anchor: Point,
  saved: ReadonlyMap<string, ParentLocalPosition>,
): Map<string, Point> {
  return new Map([...saved].map(([id, position]) => [id, {
    x: anchor.x + position.dx,
    y: anchor.y + position.dy,
  }]));
}

function safeYRange(
  band: Pick<MaturityBandRect, 'y1' | 'y2'>,
  height: number,
  inset: number,
): { min: number; max: number } {
  const halfHeight = Math.max(0, height) / 2;
  const min = band.y1 + inset + halfHeight;
  const max = band.y2 - inset - halfHeight;
  const center = (band.y1 + band.y2) / 2;
  return min <= max ? { min, max } : { min: center, max: center };
}

/** Capture child positions relative to their group and maturity-band geometry. */
export function captureLocalLayout(
  anchorX: number,
  nodes: readonly MaturityBandNodeBox[],
  bands: readonly MaturityBandRect[],
  inset = 7,
): Map<string, SavedLocalPosition> {
  const saved = new Map<string, SavedLocalPosition>();
  for (const node of nodes) {
    const band = bands[node.band];
    if (band === undefined) continue;
    const range = safeYRange(band, node.height, inset);
    const span = range.max - range.min;
    saved.set(node.id, {
      dx: node.point.x - anchorX,
      bandFraction: span <= 0 ? 0.5 : Math.max(0, Math.min(1, (node.point.y - range.min) / span)),
    });
  }
  return saved;
}

/** Restore child positions for the group's current anchor and band geometry. */
export function restoreLocalLayout(
  anchorX: number,
  saved: ReadonlyMap<string, SavedLocalPosition>,
  nodes: readonly MaturityBandNodeBox[],
  bands: readonly MaturityBandRect[],
  inset = 7,
): Map<string, Point> {
  const restored = new Map<string, Point>();
  for (const node of nodes) {
    const position = saved.get(node.id);
    const band = bands[node.band];
    if (position === undefined || band === undefined) continue;
    const range = safeYRange(band, node.height, inset);
    restored.set(node.id, {
      x: anchorX + position.dx,
      y: range.min + (range.max - range.min) * position.bandFraction,
    });
  }
  return restored;
}
