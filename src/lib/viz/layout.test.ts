import { describe, expect, it } from 'vitest';
import {
  deriveSpacing,
  fillTransformFor,
  fillPositions,
  fillScales,
  orientationFor,
  pointsBBox,
  responsiveGeometryFor,
  transformBBox,
  viewportFor,
  zoomBoundsFor,
} from './layout';

describe('deriveSpacing', () => {
  it('spreads a small view generously and keeps a large view compact', () => {
    const small = deriveSpacing(1600, 900, 12);
    const large = deriveSpacing(1600, 900, 100);
    expect(small.nodeSep).toBeGreaterThan(large.nodeSep);
    expect(small.rankSep).toBeGreaterThan(large.rankSep);
    expect(large.nodeSep).toBeGreaterThanOrEqual(14);
    expect(small.nodeSep).toBeLessThanOrEqual(110);
    expect(small.rankSep).toBeLessThanOrEqual(240);
    expect(large.rankSep).toBeGreaterThanOrEqual(50);
  });

  it('adapts cross-rank and rank spacing to viewport orientation', () => {
    const landscape = deriveSpacing(1200, 600, 20);
    const portrait = deriveSpacing(600, 1200, 20);
    expect(landscape.nodeSep).toBeGreaterThan(portrait.nodeSep);
    expect(landscape.rankSep).toBeLessThan(portrait.rankSep);
  });
});

describe('orientationFor', () => {
  it('classifies rectangular and square viewports', () => {
    expect(orientationFor({ width: 1200, height: 700 })).toBe('landscape');
    expect(orientationFor({ width: 700, height: 1200 })).toBe('portrait');
    expect(orientationFor({ width: 700, height: 700 })).toBe('landscape');
  });
});

describe('fillScales', () => {
  const caps = { maxStretch: 3, minCompressX: 0.5, minCompressY: 0.5 };

  it('matches the target aspect exactly when uncapped', () => {
    // Band 4000x500 into 1600x900: r = 4.5, needs sy=3 (capped) + sx compress.
    const mild = fillScales(2000, 1000, 1600, 900, caps); // r = 2/1.78 = 1.125
    expect((2000 * mild.sx) / (1000 * mild.sy)).toBeCloseTo(1600 / 900, 5);
    expect(mild.sy).toBeGreaterThan(1);
    expect(mild.sx).toBe(1);
  });

  it('caps the cross-axis stretch and compresses the rank axis with a floor', () => {
    const { sx, sy } = fillScales(8000, 400, 1600, 900, caps); // r ≈ 11.25
    expect(sy).toBe(3);
    expect(sx).toBe(0.5); // ideal sy/r ≈ 0.27, floored at minCompressX
  });

  it('handles the too-tall case symmetrically', () => {
    const { sx, sy } = fillScales(400, 2000, 1600, 900, caps); // r ≈ 0.11
    expect(sx).toBe(3);
    expect(sy).toBe(0.5);
  });

  it('is identity for degenerate boxes', () => {
    expect(fillScales(0, 100, 1600, 900, caps)).toEqual({ sx: 1, sy: 1 });
    expect(fillScales(100, 0, 1600, 900, caps)).toEqual({ sx: 1, sy: 1 });
  });
});

describe('fillPositions', () => {
  it('rescales about the bbox center and preserves per-axis ordering', () => {
    const positions = new Map([
      ['a', { x: 0, y: 100 }],
      ['b', { x: 500, y: 90 }],
      ['c', { x: 1000, y: 110 }],
    ]);
    const out = fillPositions(positions, { width: 1000, height: 1000 }, 0);
    // Center is preserved.
    expect((out.get('a')!.x + out.get('c')!.x) / 2).toBeCloseTo(500);
    // y span stretched (band is 1000x20 into square container).
    const ySpan = out.get('c')!.y - out.get('b')!.y;
    expect(Math.abs(ySpan)).toBeGreaterThan(20);
    // Ordering preserved on both axes.
    expect(out.get('a')!.x).toBeLessThan(out.get('b')!.x);
    expect(out.get('b')!.x).toBeLessThan(out.get('c')!.x);
    expect(out.get('b')!.y).toBeLessThan(out.get('a')!.y);
    expect(out.get('a')!.y).toBeLessThan(out.get('c')!.y);
    // Input untouched.
    expect(positions.get('a')).toEqual({ x: 0, y: 100 });
  });

  it('returns a copy for single-point input', () => {
    const out = fillPositions(new Map([['a', { x: 5, y: 6 }]]), { width: 100, height: 100 }, 10);
    expect(out.get('a')).toEqual({ x: 5, y: 6 });
  });
});

describe('viewportFor', () => {
  it('centers the bbox at a zoom that fits with padding', () => {
    const { zoom, pan } = viewportFor({ x1: 0, y1: 0, x2: 200, y2: 100 }, { width: 1000, height: 600 }, 50);
    expect(zoom).toBeCloseTo(Math.min(900 / 200, 500 / 100));
    // Model center (100, 50) maps to container center (500, 300).
    expect(100 * zoom + pan.x).toBeCloseTo(500);
    expect(50 * zoom + pan.y).toBeCloseTo(300);
  });

  it('survives degenerate boxes', () => {
    const { zoom } = viewportFor({ x1: 5, y1: 5, x2: 5, y2: 5 }, { width: 100, height: 100 }, 10);
    expect(zoom).toBe(1);
  });
});

describe('shared responsive geometry', () => {
  it('uses the same transform for nodes and maturity-band rectangles', () => {
    const positions = new Map([
      ['elementary-node', { x: 100, y: 100 }],
      ['graduate-node', { x: 300, y: 700 }],
    ]);
    // The vertical bounds represent all four configured bands, including any
    // empty middle bands; horizontal bounds include node extents.
    const sourceBounds = { x1: 0, y1: 0, x2: 400, y2: 800 };
    const result = responsiveGeometryFor(
      positions,
      sourceBounds,
      { width: 1400, height: 700 },
      50,
    );
    const secondBand = transformBBox(
      { x1: 0, y1: 200, x2: 400, y2: 400 },
      result.transform,
    );

    expect(result.orientation).toBe('landscape');
    expect(result.positions.get('elementary-node')!.y).toBeLessThan(secondBand.y1);
    expect(result.positions.get('graduate-node')!.y).toBeGreaterThan(secondBand.y2);
    expect(result.bounds.y1 * result.viewport.zoom + result.viewport.pan.y).toBeCloseTo(50);
    expect(result.bounds.y2 * result.viewport.zoom + result.viewport.pan.y).toBeCloseTo(650);
    expect(result.zoomBounds.min).toBeLessThan(result.viewport.zoom);
    expect(result.zoomBounds.max).toBeGreaterThan(result.viewport.zoom);
  });

  it('returns portrait-aware spacing and geometry on resize', () => {
    const positions = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 800, y: 400 }],
    ]);
    const bounds = { x1: 0, y1: 0, x2: 800, y2: 400 };
    const landscape = responsiveGeometryFor(positions, bounds, { width: 1200, height: 600 }, 40);
    const portrait = responsiveGeometryFor(positions, bounds, { width: 600, height: 1200 }, 40);

    expect(landscape.orientation).toBe('landscape');
    expect(portrait.orientation).toBe('portrait');
    expect(landscape.spacing.rankSep).toBeLessThan(portrait.spacing.rankSep);
    expect(landscape.transform.sy).toBeLessThan(portrait.transform.sy);
  });

  it('exposes a reusable fill transform', () => {
    const transform = fillTransformFor(
      { x1: 0, y1: 0, x2: 100, y2: 100 },
      { width: 1000, height: 500 },
      50,
    );
    const transformed = transformBBox({ x1: 0, y1: 0, x2: 100, y2: 50 }, transform);
    expect(transformed.x1).toBeLessThan(transformed.x2);
    expect(transformed.y1).toBeLessThan(transformed.y2);
  });
});

describe('zoomBoundsFor', () => {
  it('brackets the fit zoom', () => {
    const { min, max } = zoomBoundsFor(0.5);
    expect(min).toBeCloseTo(0.4);
    expect(max).toBeCloseTo(3);
  });

  it('falls back safely for invalid fit zooms', () => {
    expect(zoomBoundsFor(Number.NaN)).toEqual({ min: 0.8, max: 6 });
    expect(zoomBoundsFor(0)).toEqual({ min: 0.8, max: 6 });
  });
});

describe('pointsBBox', () => {
  it('returns null for no points', () => {
    expect(pointsBBox([])).toBeNull();
  });
});
