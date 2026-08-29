import type { Point } from './maturity-bands';

/** Axis-aligned affine transform used by the layout scene graph. */
export interface Affine2D {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Affine2D = { sx: 1, sy: 1, tx: 0, ty: 0 };

export function translate(tx: number, ty: number): Affine2D {
  return { sx: 1, sy: 1, tx, ty };
}

export function scale(sx: number, sy = sx): Affine2D {
  return { sx, sy, tx: 0, ty: 0 };
}

/** Compose transforms so the child is applied first, then the parent. */
export function compose(parent: Affine2D, child: Affine2D): Affine2D {
  return {
    sx: parent.sx * child.sx,
    sy: parent.sy * child.sy,
    tx: parent.sx * child.tx + parent.tx,
    ty: parent.sy * child.ty + parent.ty,
  };
}

export function applyTransform(transform: Affine2D, point: Point): Point {
  return {
    x: transform.sx * point.x + transform.tx,
    y: transform.sy * point.y + transform.ty,
  };
}

export function invert(transform: Affine2D): Affine2D {
  if (transform.sx === 0 || transform.sy === 0) {
    throw new Error('Cannot invert a layout transform with zero scale');
  }
  return {
    sx: 1 / transform.sx,
    sy: 1 / transform.sy,
    tx: -transform.tx / transform.sx,
    ty: -transform.ty / transform.sy,
  };
}
