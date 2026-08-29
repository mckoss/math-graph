import { describe, expect, it } from 'vitest';
import { compose, scale, translate } from './affine';
import { toLocal, toWorld, worldTransform, type LayoutFrame } from './layout-frames';

describe('layout frame transforms', () => {
  const frames = new Map<string, LayoutFrame>([
    ['root', { id: 'root', parentId: null, localToParent: translate(10, 20) }],
    ['zone:elementary', {
      id: 'zone:elementary',
      parentId: 'root',
      localToParent: translate(0, 100),
    }],
    ['group:arithmetic', {
      id: 'group:arithmetic',
      parentId: 'zone:elementary',
      localToParent: translate(200, 30),
    }],
    ['group:operations', {
      id: 'group:operations',
      parentId: 'group:arithmetic',
      localToParent: compose(translate(40, 5), scale(2)),
    }],
  ]);

  it('composes root, zone, group, subgroup, and child coordinates', () => {
    expect(worldTransform('group:operations', frames)).toEqual({
      sx: 2,
      sy: 2,
      tx: 250,
      ty: 155,
    });
    expect(toWorld({
      id: 'addition',
      parentFrameId: 'group:operations',
      point: { x: 3, y: 4 },
    }, frames)).toEqual({ x: 256, y: 163 });
  });

  it('inverse-maps a world drag into the immediate parent coordinate system', () => {
    const world = { x: 310, y: 215 };
    const local = toLocal(world, 'group:operations', frames);
    expect(local).toEqual({ x: 30, y: 30 });
    expect(toWorld({ id: 'addition', parentFrameId: 'group:operations', point: local }, frames))
      .toEqual(world);
  });

  it('rejects missing and cyclic frames', () => {
    expect(() => worldTransform('missing', frames)).toThrow(/Unknown layout frame/);
    const cyclic = new Map<string, LayoutFrame>([
      ['a', { id: 'a', parentId: 'b', localToParent: translate(0, 0) }],
      ['b', { id: 'b', parentId: 'a', localToParent: translate(0, 0) }],
    ]);
    expect(() => worldTransform('a', cyclic)).toThrow(/cycle/);
  });
});
