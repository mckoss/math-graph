export interface ZoomSearchOptions {
  startZoom: number;
  maximumZoom: number;
  iterations?: number;
}

export interface RenderedBlockRect {
  id: string;
  parentId?: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DirectedPair {
  from: string;
  to: string;
}

/** Longest-path topological ranks; prerequisites always precede dependents. */
export function dependencyRanks(
  nodeIds: Iterable<string>,
  edges: readonly DirectedPair[],
): Map<string, number> {
  const ids = new Set(nodeIds);
  const ranks = new Map([...ids].map((id) => [id, 0]));
  const internal = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  // Knowledge graphs are schema-validated DAGs. The bounded passes also make
  // this helper deterministic and safe if invoked on malformed ad-hoc data.
  for (let pass = 0; pass < ids.size; pass++) {
    let changed = false;
    for (const edge of internal) {
      const next = (ranks.get(edge.from) ?? 0) + 1;
      if (next > (ranks.get(edge.to) ?? 0)) {
        ranks.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return ranks;
}

/** Count intersecting visible blocks, excluding legitimate containment. */
export function nonContainmentOverlapCount(
  blocks: readonly RenderedBlockRect[],
  gap = 0,
): number {
  const parentById = new Map(blocks.map((block) => [block.id, block.parentId]));
  const isAncestor = (ancestorId: string, id: string): boolean => {
    let parent = parentById.get(id);
    while (parent !== undefined) {
      if (parent === ancestorId) return true;
      parent = parentById.get(parent);
    }
    return false;
  };
  let count = 0;
  for (let left = 0; left < blocks.length; left++) {
    for (let right = left + 1; right < blocks.length; right++) {
      const a = blocks[left];
      const b = blocks[right];
      if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue;
      if (
        Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap > 0 &&
        Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap > 0
      ) count += 1;
    }
  }
  return count;
}

/** Find the lowest zoom at or above startZoom for which a layout is safe. */
export function minimumFeasibleZoom(
  isFeasible: (zoom: number) => boolean,
  options: ZoomSearchOptions,
): number | null {
  const start = Math.max(0.001, options.startZoom);
  const maximum = Math.max(start, options.maximumZoom);
  if (isFeasible(start)) return start;
  if (!isFeasible(maximum)) return null;

  let low = start;
  let high = maximum;
  for (let index = 0; index < (options.iterations ?? 14); index++) {
    const middle = (low + high) / 2;
    if (isFeasible(middle)) high = middle;
    else low = middle;
  }
  return high;
}

/**
 * Requested groups whose recorded threshold fits the camera. Ancestors must
 * be visible before descendants; reopening uses a margin to avoid flicker.
 */
export function feasibleRequestedGroups(
  requested: ReadonlySet<string>,
  current: ReadonlySet<string>,
  requiredZoom: ReadonlyMap<string, number>,
  zoom: number,
  parentById: ReadonlyMap<string, string | undefined>,
  reopenRatio = 1.06,
): Set<string> {
  const result = new Set<string>();
  const depth = (id: string): number => {
    let count = 0;
    let parent = parentById.get(id);
    while (parent !== undefined) {
      count += 1;
      parent = parentById.get(parent);
    }
    return count;
  };
  const ordered = [...requested].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  for (const id of ordered) {
    const parent = parentById.get(id);
    if (parent !== undefined && requested.has(parent) && !result.has(parent)) continue;
    const threshold = requiredZoom.get(id) ?? 0;
    const limit = current.has(id) ? threshold : threshold * reopenRatio;
    if (zoom + 1e-6 >= limit) result.add(id);
  }
  return result;
}
