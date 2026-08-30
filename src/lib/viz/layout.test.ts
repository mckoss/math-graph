import { describe, expect, it } from 'vitest';
import { viewportFor, zoomBoundsFor } from './layout';

describe('viewportFor', () => {
  it('fits and centers model bounds inside the padded viewport', () => {
    expect(viewportFor(
      { x1: 0, y1: 0, x2: 200, y2: 100 },
      { width: 500, height: 300 },
      50,
    )).toEqual({ zoom: 2, pan: { x: 50, y: 50 } });
  });

  it('uses a stable default for degenerate bounds', () => {
    expect(viewportFor(
      { x1: 20, y1: 30, x2: 20, y2: 30 },
      { width: 200, height: 100 },
      10,
    )).toEqual({ zoom: 1, pan: { x: 80, y: 20 } });
  });
});

describe('zoomBoundsFor', () => {
  it('allows overview zooming while retaining a useful maximum', () => {
    expect(zoomBoundsFor(0.5)).toEqual({ min: 0.4, max: 3 });
    expect(zoomBoundsFor(2)).toEqual({ min: 1.6, max: 12 });
    expect(zoomBoundsFor(Number.NaN)).toEqual({ min: 0.8, max: 6 });
  });
});
