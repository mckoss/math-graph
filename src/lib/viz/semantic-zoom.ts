import type { ConceptGraph } from '../types';
import { ancestorsOf, computeVisible, nodesById, type VisibleGraph } from './graph-model';

export const OVERVIEW_REVEAL_VIEWPORT_FRACTION = 0.75;
export const MINIMUM_THRESHOLD_FACTOR = 1.3;

export interface SemanticGroupExtent {
  depth: number;
  width: number;
  height: number;
}

export interface SemanticViewportSize {
  width: number;
  height: number;
}

/**
 * Derive one global reveal point for every hierarchy depth in a loaded graph.
 *
 * A level opens before its largest overview group grows beyond a comfortable
 * fraction of the initial viewport. Deeper levels remain distinct even when
 * their groups happen to be larger than their parents or a level has no group.
 */
export function semanticZoomThresholds(
  groups: readonly SemanticGroupExtent[],
  viewport: SemanticViewportSize,
  depthCount: number,
  viewportFraction = OVERVIEW_REVEAL_VIEWPORT_FRACTION,
  minimumFactor = MINIMUM_THRESHOLD_FACTOR,
): number[] {
  if (depthCount <= 0) return [];
  const viewportShortSide = Math.min(viewport.width, viewport.height);
  const targetRenderedSize = Math.max(1, viewportShortSide * viewportFraction);
  const thresholds: number[] = [];

  for (let depth = 0; depth < depthCount; depth += 1) {
    const largestDimension = Math.max(
      0,
      ...groups
        .filter((group) => group.depth === depth)
        .map((group) => Math.max(group.width, group.height))
        .filter(Number.isFinite),
    );
    const sizeBasedThreshold = largestDimension > 0
      ? targetRenderedSize / largestDimension
      : undefined;
    const previousThreshold = thresholds.at(-1);
    const orderedThreshold = previousThreshold === undefined
      ? sizeBasedThreshold ?? 1
      : Math.max(sizeBasedThreshold ?? 0, previousThreshold * minimumFactor);
    thresholds.push(Math.max(Number.EPSILON, orderedThreshold));
  }

  return thresholds;
}

/** Number of hierarchy levels revealed globally at this camera zoom. */
export function semanticDepthForZoom(
  zoom: number,
  thresholds: readonly number[],
): number {
  return thresholds.filter((threshold) => zoom >= threshold).length;
}

/** Zoom at which direct children of groups at `groupDepth` become visible. */
export function thresholdForGroupDepth(
  groupDepth: number,
  thresholds: readonly number[],
): number {
  const depth = Math.max(0, Math.floor(groupDepth));
  if (thresholds.length === 0) return 1;
  if (depth < thresholds.length) return thresholds[depth];
  return thresholds.at(-1)! * Math.pow(MINIMUM_THRESHOLD_FACTOR, depth - thresholds.length + 1);
}

/** Hierarchy-preserving paint projection for one semantic depth. */
export function semanticProjection(graph: ConceptGraph, revealedDepth: number): VisibleGraph {
  const byId = nodesById(graph);
  const expanded = new Set(
    graph.nodes
      .filter((node) => node.isGroup && ancestorsOf(byId, node.id).length < revealedDepth)
      .map((node) => node.id),
  );
  return computeVisible(graph, expanded);
}
