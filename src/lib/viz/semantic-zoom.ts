import type { ConceptGraph } from '../types';
import { ancestorsOf, computeVisible, nodesById, type VisibleGraph } from './graph-model';

export const FIRST_DETAIL_ZOOM = 1;
export const DETAIL_ZOOM_FACTOR = 1.75;

/** Number of hierarchy levels revealed globally at this camera zoom. */
export function semanticDepthForZoom(
  zoom: number,
  firstThreshold = FIRST_DETAIL_ZOOM,
  factor = DETAIL_ZOOM_FACTOR,
): number {
  if (zoom < firstThreshold) return 0;
  return 1 + Math.floor(Math.log(zoom / firstThreshold) / Math.log(factor));
}

/** Zoom at which direct children of groups at `groupDepth` become visible. */
export function thresholdForGroupDepth(
  groupDepth: number,
  firstThreshold = FIRST_DETAIL_ZOOM,
  factor = DETAIL_ZOOM_FACTOR,
): number {
  return firstThreshold * Math.pow(factor, Math.max(0, groupDepth));
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
