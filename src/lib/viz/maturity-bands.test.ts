import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import {
  assignMaturityBands,
  clampPointToMaturityBand,
  constrainPointAgainstMaturityBandNodes,
  expandMaturityBandRects,
  expandBandForBlock,
  fitMaturityBandsToNodes,
  nodeBoxesOverlap,
  placeInMaturityBands,
  packMaturityBandNodes,
  separateMaturityBandNodes,
  separateMaturityPeersFromPinned,
} from './maturity-bands';

const maturityLevels = [
  { id: 'graduate', label: 'Graduate', order: 4, color: '#444', tint: '#ddd' },
  { id: 'elementary', label: 'Elementary', order: 1, color: '#111', tint: '#aaa' },
  { id: 'undergraduate', label: 'Undergraduate', order: 3, color: '#333', tint: '#ccc' },
  { id: 'high-school', label: 'High School', order: 2, color: '#222', tint: '#bbb' },
];

describe('assignMaturityBands', () => {
  it('uses the explicit data-defined level for concepts and groups', () => {
    const graph: ConceptGraph = {
      metadata: { id: 'example', topic: 'Example' },
      maturityLevels,
      nodes: [
        { id: 'field', label: 'Field', isGroup: true, maturityLevel: 'undergraduate' },
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

  it('honors explicit data-derived band weights', () => {
    const result = placeInMaturityBands(new Map(), new Map(), 0, 400, 2, [3, 1]);
    expect(result.bandRects[0].y2 - result.bandRects[0].y1).toBeCloseTo(300);
    expect(result.bandRects[1].y2 - result.bandRects[1].y1).toBeCloseTo(100);
  });
});

describe('expandMaturityBandRects', () => {
  it('grows requested bands and shifts every later band downward', () => {
    const expanded = expandMaturityBandRects(
      [
        { band: 0, y1: 100, y2: 200, count: 2 },
        { band: 1, y1: 200, y2: 320, count: 3 },
        { band: 2, y1: 320, y2: 400, count: 0 },
      ],
      new Map([[0, 180], [2, 100]]),
    );

    expect(expanded).toEqual([
      { band: 0, y1: 100, y2: 280, count: 2 },
      { band: 1, y1: 280, y2: 400, count: 3 },
      { band: 2, y1: 400, y2: 500, count: 0 },
    ]);
  });
});

describe('drag-resized maturity bands', () => {
  const bands = [
    { band: 0, y1: 0, y2: 100, count: 1 },
    { band: 1, y1: 100, y2: 200, count: 1 },
    { band: 2, y1: 200, y2: 300, count: 1 },
  ];

  it('expands downward and shifts every later band and its members', () => {
    const result = expandBandForBlock(bands, 1, { x: 20, y: 230 }, 40, 10);
    expect(result.bands[1]).toMatchObject({ y1: 100, y2: 260 });
    expect(result.bands[2]).toMatchObject({ y1: 260, y2: 360 });
    expect(result.shifts.get(2)).toBe(60);
  });

  it('expands upward and shifts every earlier band and its members', () => {
    const result = expandBandForBlock(bands, 1, { x: 20, y: 70 }, 40, 10);
    expect(result.bands[0]).toMatchObject({ y1: -60, y2: 40 });
    expect(result.bands[1]).toMatchObject({ y1: 40, y2: 200 });
    expect(result.shifts.get(0)).toBe(-60);
  });

  it('contracts bands to their member bounds while preserving order', () => {
    const result = fitMaturityBandsToNodes(
      [
        { id: 'a', band: 0, point: { x: 10, y: 40 }, width: 20, height: 20 },
        { id: 'b', band: 0, point: { x: 10, y: 80 }, width: 20, height: 20 },
        { id: 'c', band: 2, point: { x: 10, y: 250 }, width: 20, height: 20 },
      ],
      bands,
      42,
      10,
    );
    expect(result.bands.map((band) => band.y2 - band.y1)).toEqual([80, 42, 42]);
    expect(result.bands[1].y1).toBe(result.bands[0].y2);
    expect(result.bands[2].y1).toBe(result.bands[1].y2);
    expect(result.positions.get('a')!.y).toBe(20);
    expect(result.positions.get('c')!.y).toBe(142);
  });

  it('derives zone-local coordinates while preserving a dragged anchor', () => {
    const result = fitMaturityBandsToNodes(
      [
        { id: 'a', band: 0, point: { x: 10, y: 40 }, width: 20, height: 20 },
        { id: 'dragged', band: 1, point: { x: 10, y: 260 }, width: 20, height: 20 },
        { id: 'peer', band: 1, point: { x: 10, y: 150 }, width: 20, height: 20 },
        { id: 'c', band: 2, point: { x: 10, y: 250 }, width: 20, height: 20 },
      ],
      bands,
      42,
      10,
      'dragged',
    );

    expect(result.positions.get('dragged')!.y).toBe(260);
    expect(result.bands[1].y2 - result.bands[1].y1).toBe(150);
    expect(result.bands[1].y1).toBe(result.bands[0].y2);
    expect(result.bands[2].y1).toBe(result.bands[1].y2);
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

describe('constrainPointAgainstMaturityBandNodes', () => {
  it('keeps a dragged block inside its band and out of peer blocks', () => {
    const band = { band: 0, y1: 100, y2: 260, count: 2 };
    const moving = {
      id: 'moving',
      band: 0,
      point: { x: 0, y: 0 },
      width: 120,
      height: 50,
    };
    const peer = {
      id: 'peer',
      band: 0,
      point: { x: 100, y: 180 },
      width: 120,
      height: 50,
    };
    const point = constrainPointAgainstMaturityBandNodes(
      moving,
      { x: 100, y: 180 },
      [peer],
      band,
      10,
    );

    expect(point.y).toBeGreaterThanOrEqual(132);
    expect(point.y).toBeLessThanOrEqual(228);
    expect(nodeBoxesOverlap(moving, point, peer, peer.point, 10)).toBe(false);
  });
});

describe('separateMaturityPeersFromPinned', () => {
  it('keeps the dragged block exact and moves a colliding peer chain', () => {
    const pinned = {
      id: 'pinned',
      band: 0,
      point: { x: 100, y: 400 },
      width: 100,
      height: 40,
    };
    const peers = [
      { id: 'peer-a', band: 0, point: { x: 130, y: 400 }, width: 100, height: 40 },
      { id: 'peer-b', band: 0, point: { x: 210, y: 400 }, width: 100, height: 40 },
    ];
    const positions = separateMaturityPeersFromPinned(pinned, peers, 10);

    expect(positions.get('pinned')).toEqual(pinned.point);
    for (let left = 0; left < peers.length + 1; left++) {
      const boxes = [pinned, ...peers];
      for (let right = left + 1; right < boxes.length; right++) {
        expect(nodeBoxesOverlap(
          boxes[left],
          positions.get(boxes[left].id)!,
          boxes[right],
          positions.get(boxes[right].id)!,
          10,
        )).toBe(false);
      }
    }
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
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(
          nodeBoxesOverlap(nodes[i], result.get(nodes[i].id)!, nodes[j], result.get(nodes[j].id)!, 10),
        ).toBe(false);
      }
    }
  });
});
