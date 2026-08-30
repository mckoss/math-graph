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
