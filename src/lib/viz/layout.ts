/**
 * Pure layout math for the viewport-filling graph layout.
 *
 * Rank flow is always top-to-bottom, but dagre alone produces a drawing whose
 * aspect ratio is dictated by rank structure, wasting space on wide screens.
 * The functions here post-process dagre's positions with a per-axis affine
 * rescale so the drawing's aspect ratio approaches the container's (on
 * landscape viewports this stretches the within-rank x axis; on portrait ones
 * the TB layout mostly fits already), then compute the viewport (zoom/pan)
 * and dynamic zoom bounds for the result. Per-axis affine transforms preserve
 * rank ordering exactly.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Orientation = 'landscape' | 'portrait';

export interface AffineTransform {
  /** Scale applied to model-space x coordinates. */
  sx: number;
  /** Scale applied to model-space y coordinates. */
  sy: number;
  /** Model-space center about which both scales are applied. */
  center: Point;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface Spacing {
  nodeSep: number;
  rankSep: number;
  edgeSep: number;
}

/**
 * Derive dagre separations from container size and visible node count: a
 * small collapsed view spreads generously, a ~100-node expanded view stays
 * compact enough to read. Rank flow is always top-to-bottom (mathematical
 * maturity increases downward), so ranks spread along y and siblings along x.
 */
export function deriveSpacing(width: number, height: number, nodeCount: number): Spacing {
  const crossDim = width;
  const rankDim = height;
  const n = Math.max(1, nodeCount);
  const nodeSep = clamp(Math.round(crossDim / Math.max(6, n * 0.75)), 14, 110);
  const rankSep = clamp(Math.round(rankDim / Math.max(5, Math.sqrt(n) * 2)), 50, 240);
  return { nodeSep, rankSep, edgeSep: 12 };
}

export interface FillCaps {
  /** Never stretch an axis by more than this factor. */
  maxStretch: number;
  /** Never compress the x axis below this factor of its dagre spacing. */
  minCompressX: number;
  /** Never compress the y axis below this factor of its dagre spacing. */
  minCompressY: number;
}

export const DEFAULT_FILL_CAPS: FillCaps = {
  maxStretch: 3,
  minCompressX: 0.5,
  minCompressY: 0.5,
};

/** Square viewports use the landscape profile to make use of their width. */
export function orientationFor(container: Size): Orientation {
  return container.width >= container.height ? 'landscape' : 'portrait';
}

/**
 * Per-axis scale factors that bring a bbox of the given dimensions toward the
 * target aspect ratio. The too-thin axis is stretched (capped at maxStretch);
 * any remaining mismatch is taken up by compressing the other axis (floored
 * at its minCompress). Scales are always positive, so per-node ordering along
 * each axis (and therefore rank ordering) is preserved.
 */
export function fillScales(
  bboxW: number,
  bboxH: number,
  targetW: number,
  targetH: number,
  caps: FillCaps = DEFAULT_FILL_CAPS,
): { sx: number; sy: number } {
  if (bboxW <= 0 || bboxH <= 0 || targetW <= 0 || targetH <= 0) return { sx: 1, sy: 1 };
  // r > 1: drawing is too wide for the container; r < 1: too tall.
  const r = bboxW / bboxH / (targetW / targetH);
  let sx = 1;
  let sy = 1;
  if (r > 1) {
    sy = Math.min(r, caps.maxStretch);
    sx = Math.max(caps.minCompressX, sy / r);
  } else if (r < 1) {
    sx = Math.min(1 / r, caps.maxStretch);
    sy = Math.max(caps.minCompressY, sx * r);
  }
  return { sx, sy };
}

/** Bounding box of a set of points, or null when empty. */
export function pointsBBox(points: Iterable<Point>): BBox | null {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let any = false;
  for (const p of points) {
    any = true;
    if (p.x < x1) x1 = p.x;
    if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x;
    if (p.y > y2) y2 = p.y;
  }
  return any ? { x1, y1, x2, y2 } : null;
}

/**
 * Rescale node positions about their bounding-box center so the drawing's
 * aspect ratio approaches the container's (minus padding). Returns a new map;
 * input is not mutated.
 */
export function fillPositions(
  positions: ReadonlyMap<string, Point>,
  container: Size,
  padding: number,
  caps: FillCaps = DEFAULT_FILL_CAPS,
): Map<string, Point> {
  const bbox = pointsBBox(positions.values());
  if (bbox === null) return new Map();
  return transformPositions(positions, fillTransformFor(bbox, container, padding, caps));
}

/**
 * The shared affine transform for nodes and non-node model geometry such as
 * maturity-band rectangles. Keeping one transform prevents background bands
 * from drifting away from their nodes after responsive viewport changes.
 */
export function fillTransformFor(
  bbox: BBox,
  container: Size,
  padding: number,
  caps: FillCaps = DEFAULT_FILL_CAPS,
): AffineTransform {
  const { sx, sy } = fillScales(
    bbox.x2 - bbox.x1,
    bbox.y2 - bbox.y1,
    Math.max(1, container.width - 2 * Math.max(0, padding)),
    Math.max(1, container.height - 2 * Math.max(0, padding)),
    caps,
  );
  return {
    sx,
    sy,
    center: { x: (bbox.x1 + bbox.x2) / 2, y: (bbox.y1 + bbox.y2) / 2 },
  };
}

export function transformPoint(point: Point, transform: AffineTransform): Point {
  return {
    x: transform.center.x + (point.x - transform.center.x) * transform.sx,
    y: transform.center.y + (point.y - transform.center.y) * transform.sy,
  };
}

export function transformPositions(
  positions: ReadonlyMap<string, Point>,
  transform: AffineTransform,
): Map<string, Point> {
  return new Map([...positions].map(([id, point]) => [id, transformPoint(point, transform)]));
}

export function transformBBox(bbox: BBox, transform: AffineTransform): BBox {
  const topLeft = transformPoint({ x: bbox.x1, y: bbox.y1 }, transform);
  const bottomRight = transformPoint({ x: bbox.x2, y: bbox.y2 }, transform);
  return { x1: topLeft.x, y1: topLeft.y, x2: bottomRight.x, y2: bottomRight.y };
}

/** The zoom and pan that center the given model bbox in the container. */
export function viewportFor(bbox: BBox, container: Size, padding: number): { zoom: number; pan: Point } {
  const bw = bbox.x2 - bbox.x1;
  const bh = bbox.y2 - bbox.y1;
  let zoom =
    bw <= 0 && bh <= 0
      ? 1
      : Math.min(
          bw > 0 ? (container.width - 2 * padding) / bw : Infinity,
          bh > 0 ? (container.height - 2 * padding) / bh : Infinity,
        );
  if (!Number.isFinite(zoom) || zoom <= 0) zoom = 1;
  return {
    zoom,
    pan: {
      x: container.width / 2 - zoom * ((bbox.x1 + bbox.x2) / 2),
      y: container.height / 2 - zoom * ((bbox.y1 + bbox.y2) / 2),
    },
  };
}

/** Dynamic zoom clamp around a fit zoom: a bit below fit up to a useful multiple. */
export function zoomBoundsFor(fitZoom: number): { min: number; max: number } {
  const safeFit = Number.isFinite(fitZoom) && fitZoom > 0 ? fitZoom : 1;
  return { min: safeFit * 0.8, max: safeFit * 6 };
}

export interface ResponsiveGeometry {
  orientation: Orientation;
  spacing: Spacing;
  transform: AffineTransform;
  positions: Map<string, Point>;
  /** Transformed bounds shared by the graph and maturity-band backgrounds. */
  bounds: BBox;
  viewport: { zoom: number; pan: Point };
  zoomBounds: { min: number; max: number };
}

/**
 * Compute all resize-sensitive geometry in one pure call. `sourceBounds`
 * should combine the nodes' horizontal bounds with the full configured
 * maturity-band vertical extent, including empty bands. Consumers can apply
 * `transform` to every band rectangle with `transformBBox`.
 */
export function responsiveGeometryFor(
  positions: ReadonlyMap<string, Point>,
  sourceBounds: BBox,
  container: Size,
  padding: number,
): ResponsiveGeometry {
  const transform = fillTransformFor(sourceBounds, container, padding);
  const bounds = transformBBox(sourceBounds, transform);
  const viewport = viewportFor(bounds, container, padding);
  return {
    orientation: orientationFor(container),
    spacing: deriveSpacing(container.width, container.height, positions.size),
    transform,
    positions: transformPositions(positions, transform),
    bounds,
    viewport,
    zoomBounds: zoomBoundsFor(viewport.zoom),
  };
}
