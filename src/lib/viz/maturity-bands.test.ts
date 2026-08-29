import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import {
  assignMaturityBands,
  clampPointToMaturityBand,
  placeInMaturityBands,
  packMaturityBandNodes,
  separateMaturityBandNodes,
} from './maturity-bands';

const maturityLevels = [
  { id: 'graduate', label: 'Graduate', order: 4, color: '#444', tint: '#ddd' },
  { id: 'elementary', label: 'Elementary', order: 1, color: '#111', tint: '#aaa' },
  { id: 'undergraduate', label: 'Undergraduate', order: 3, color: '#333', tint: '#ccc' },
  { id: 'high-school', label: 'High School', order: 2, color: '#222', tint: '#bbb' },
];

describe('assignMaturityBands', () => {
  it('uses explicit levels and the lower median descendant level for groups', () => {
    const graph: ConceptGraph = {
      maturityLevels,
      nodes: [
        { id: 'field', label: 'Field', isGroup: true },
        {
          id: 'intro',
          label: 'Intro',
          isGroup: false,
          parent: 'field',
          maturityLevel: 'elementary',
        },
        {
          id: 'advanced',
          label: 'Advanced',
          isGroup: false,
          parent: 'field',
          maturityLevel: 'undergraduate',
        },
        {
          id: 'research',
          label: 'Research',
          isGroup: false,
          parent: 'field',
          maturityLevel: 'graduate',
        },
      ],
      edges: [],
    };

    const bands = assignMaturityBands(graph);
    expect(bands.get('intro')).toBe(0);
    expect(bands.get('advanced')).toBe(2);
    expect(bands.get('research')).toBe(3);
    expect(bands.get('field')).toBe(2);
  });
});

describe('placeInMaturityBands', () => {
  it('always returns four ordered bands, including an empty graduate band', () => {
    const result = placeInMaturityBands(
      new Map([
        ['early', { x: 10, y: 100 }],
        ['college', { x: 20, y: 200 }],
      ]),
      new Map([
        ['early', 0],
        ['college', 2],
      ]),
      40,
      800,
      maturityLevels.length,
    );

    expect(result.bandRects).toHaveLength(4);
    expect(result.bandRects[0].y1).toBe(40);
    expect(result.bandRects.at(-1)!.y2).toBeCloseTo(840);
    expect(result.bandRects[1].y2 - result.bandRects[1].y1).toBeLessThan(
      result.bandRects[0].y2 - result.bandRects[0].y1,
    );
    expect(result.bandRects[3].y2 - result.bandRects[3].y1).toBeLessThan(
      result.bandRects[2].y2 - result.bandRects[2].y1,
    );
    expect(result.positions.get('early')!.y).toBeLessThan(
      result.positions.get('college')!.y,
    );
  });

  it('preserves relative vertical order within a band', () => {
    const result = placeInMaturityBands(
      new Map([
        ['prerequisite', { x: 0, y: 10 }],
        ['dependent', { x: 0, y: 90 }],
      ]),
      new Map([
        ['prerequisite', 1],
        ['dependent', 1],
      ]),
      0,
      400,
      4,
    );

    expect(result.positions.get('prerequisite')!.y).toBeLessThan(
      result.positions.get('dependent')!.y,
    );
  });

  it('uses the configured number of bands rather than a fixed count', () => {
    const result = placeInMaturityBands(new Map(), new Map(), 0, 300, 3);
    expect(result.bandRects).toHaveLength(3);
    expect(result.bandRects[0].y1).toBeCloseTo(0);
    expect(result.bandRects[1].y1).toBeCloseTo(100);
    expect(result.bandRects[2].y1).toBeCloseTo(200);
  });
});

describe('clampPointToMaturityBand', () => {
  const band = { y1: 100, y2: 220 };

  it('keeps the full node block inside its band while preserving x', () => {
    expect(clampPointToMaturityBand({ x: 42, y: 20 }, band, 40, 5)).toEqual({
      x: 42,
      y: 125,
    });
    expect(clampPointToMaturityBand({ x: 42, y: 300 }, band, 40, 5)).toEqual({
      x: 42,
      y: 195,
    });
    expect(clampPointToMaturityBand({ x: 42, y: 160 }, band, 40, 5)).toEqual({
      x: 42,
      y: 160,
    });
  });

  it('centers a block when the band is too short to contain it', () => {
    expect(clampPointToMaturityBand({ x: 8, y: 999 }, band, 200, 5)).toEqual({
      x: 8,
      y: 160,
    });
  });
});

describe('separateMaturityBandNodes', () => {
  it('separates overlapping blocks while keeping them inside their shared band', () => {
    const bands = [{ band: 0, y1: 100, y2: 300, count: 2 }];
    const result = separateMaturityBandNodes(
      [
        { id: 'left', band: 0, point: { x: 100, y: 190 }, width: 140, height: 60 },
        { id: 'right', band: 0, point: { x: 190, y: 200 }, width: 140, height: 60 },
      ],
      bands,
      10,
    );
    const left = result.get('left')!;
    const right = result.get('right')!;

    expect(Math.abs(right.y - left.y)).toBeGreaterThanOrEqual(70);
    expect(left.y).toBeGreaterThanOrEqual(137);
    expect(right.y).toBeLessThanOrEqual(263);
  });
});

describe('packMaturityBandNodes', () => {
  it('wraps dense nodes into rows bounded by the requested width', () => {
    const bands = [{ band: 0, y1: 0, y2: 300, count: 5 }];
    const nodes = Array.from({ length: 5 }, (_, index) => ({
      id: `node-${index}`,
      band: 0,
      point: { x: index * 200, y: index },
      width: 100,
      height: 40,
    }));
    const result = packMaturityBandNodes(nodes, bands, 340, 10);
    const points = [...result.values()];

    expect(Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))).toBeLessThanOrEqual(220);
    expect(new Set(points.map((point) => point.y)).size).toBe(2);
  });
});
