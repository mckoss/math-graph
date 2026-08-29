import type { Point } from './maturity-bands';
import {
  IDENTITY,
  applyTransform,
  compose,
  invert,
  type Affine2D,
} from './affine';

export interface LayoutFrame {
  id: string;
  parentId: string | null;
  localToParent: Affine2D;
}

export interface LocalPlacement {
  id: string;
  parentFrameId: string;
  point: Point;
}

export function worldTransform(
  frameId: string,
  frames: ReadonlyMap<string, LayoutFrame>,
): Affine2D {
  const visiting = new Set<string>();
  const resolve = (id: string): Affine2D => {
    if (visiting.has(id)) throw new Error(`Layout frame cycle at ${id}`);
    const frame = frames.get(id);
    if (frame === undefined) throw new Error(`Unknown layout frame ${id}`);
    visiting.add(id);
    const parent = frame.parentId === null ? IDENTITY : resolve(frame.parentId);
    visiting.delete(id);
    return compose(parent, frame.localToParent);
  };
  return resolve(frameId);
}

export function toWorld(
  placement: LocalPlacement,
  frames: ReadonlyMap<string, LayoutFrame>,
): Point {
  return applyTransform(worldTransform(placement.parentFrameId, frames), placement.point);
}

/** Inverse-map an accepted world drag point into its immediate parent frame. */
export function toLocal(
  worldPoint: Point,
  parentFrameId: string,
  frames: ReadonlyMap<string, LayoutFrame>,
): Point {
  return applyTransform(invert(worldTransform(parentFrameId, frames)), worldPoint);
}
