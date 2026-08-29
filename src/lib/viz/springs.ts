/**
 * Lightweight drag-scoped spring relaxation ("weights and springs" feel).
 *
 * When a node is grabbed, the ~2-hop neighborhood is snapshotted into a
 * SpringSystem of flat typed arrays. During the drag, springStep runs a few
 * position-based relaxation iterations per animation frame: each edge pulls
 * its endpoints toward the rest length it had at grab time, weighted by each
 * node's mobility (0 for the dragged anchor, decaying with hop distance), and
 * each mobile node is gently restored toward its grab-time home position so
 * the effect stays subtle. This is deliberately NOT a global physics layout —
 * it never touches nodes outside the neighborhood and never moves the anchor.
 *
 * Index 0 of the system is always the anchor (dragged node); its position is
 * written by the caller each frame and its weight must be 0.
 */

export interface SpringNodeInput {
  id: string;
  x: number;
  y: number;
  /** Mobility 0..1; 0 = immovable (the anchor). */
  weight: number;
}

/** Mobility by hop distance from the dragged node. */
export const HOP_WEIGHTS = [0, 0.4, 0.15];

export interface SpringOptions {
  /** Fraction of the rest-length error corrected per iteration. */
  stiffness: number;
  /** Per-step pull of mobile nodes back toward their grab-time positions. */
  restore: number;
  /** Relaxation iterations per step (per animation frame). */
  iterations: number;
}

export const DEFAULT_SPRING_OPTIONS: SpringOptions = {
  stiffness: 0.28,
  restore: 0.3,
  iterations: 2,
};

export interface SpringSystem {
  /** ids[0] is the anchor (dragged node). */
  ids: string[];
  x: Float64Array;
  y: Float64Array;
  homeX: Float64Array;
  homeY: Float64Array;
  weight: Float64Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  rest: Float64Array;
}

/**
 * Build a system from nodes (anchor first) and edges given as index pairs
 * into the node list. Rest lengths are the current distances.
 */
export function createSpringSystem(
  nodes: readonly SpringNodeInput[],
  edges: ReadonlyArray<readonly [number, number]>,
): SpringSystem {
  const n = nodes.length;
  const sys: SpringSystem = {
    ids: nodes.map((nd) => nd.id),
    x: new Float64Array(n),
    y: new Float64Array(n),
    homeX: new Float64Array(n),
    homeY: new Float64Array(n),
    weight: new Float64Array(n),
    edgeA: new Int32Array(edges.length),
    edgeB: new Int32Array(edges.length),
    rest: new Float64Array(edges.length),
  };
  nodes.forEach((nd, i) => {
    sys.x[i] = nd.x;
    sys.y[i] = nd.y;
    sys.homeX[i] = nd.x;
    sys.homeY[i] = nd.y;
    sys.weight[i] = i === 0 ? 0 : nd.weight;
  });
  edges.forEach(([a, b], e) => {
    sys.edgeA[e] = a;
    sys.edgeB[e] = b;
    sys.rest[e] = Math.hypot(sys.x[b] - sys.x[a], sys.y[b] - sys.y[a]);
  });
  return sys;
}

/** Move the anchor (index 0); called by the drag handler each frame. */
export function setAnchor(sys: SpringSystem, x: number, y: number): void {
  sys.x[0] = x;
  sys.y[0] = y;
}

/**
 * Run one spring step in place (no allocation). `scale` in [0..1] scales the
 * forces; the free-settle phase decays it toward 0 so motion eases out and
 * whatever positions result simply persist.
 */
export function springStep(
  sys: SpringSystem,
  opts: SpringOptions = DEFAULT_SPRING_OPTIONS,
  scale = 1,
): void {
  const { x, y, homeX, homeY, weight, edgeA, edgeB, rest } = sys;
  const k = opts.stiffness * scale;
  const restore = opts.restore * scale;
  for (let it = 0; it < opts.iterations; it++) {
    for (let e = 0; e < edgeA.length; e++) {
      const a = edgeA[e];
      const b = edgeB[e];
      const wa = weight[a];
      const wb = weight[b];
      const wsum = wa + wb;
      if (wsum === 0) continue;
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const diff = ((len - rest[e]) / len) * k;
      x[a] += dx * diff * (wa / wsum);
      y[a] += dy * diff * (wa / wsum);
      x[b] -= dx * diff * (wb / wsum);
      y[b] -= dy * diff * (wb / wsum);
    }
    for (let i = 1; i < x.length; i++) {
      const w = weight[i];
      if (w === 0) continue;
      x[i] += (homeX[i] - x[i]) * restore;
      y[i] += (homeY[i] - y[i]) * restore;
    }
  }
}
