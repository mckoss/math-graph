/** Camera geometry for the canonical graph layout. */

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
