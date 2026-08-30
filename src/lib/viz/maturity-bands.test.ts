import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import {
  assignMaturityBands,
  clampPointToMaturityBand,
  constrainPointAgainstMaturityBandNodes,
  expandMaturityBandRects,
  expandBandForBlock,
  fitMaturityBandsAroundFixedBand,
  fitMaturityBandsToNodes,
  nodeBoxesOverlap,
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

  it('keeps every member of the dragged band fixed and shifts only adjacent zones', () => {
    const result = fitMaturityBandsAroundFixedBand(
      [
        { id: 'earlier', band: 0, point: { x: 0, y: 50 }, width: 20, height: 20 },
        { id: 'parent', band: 1, point: { x: 0, y: 130 }, width: 20, height: 20 },
        { id: 'dragged', band: 1, point: { x: 0, y: 250 }, width: 20, height: 20 },
        { id: 'later', band: 2, point: { x: 0, y: 250 }, width: 20, height: 20 },
      ],
      bands,
      1,
      42,
      7,
    );

    expect(result.positions.get('parent')!.y).toBe(130);
    expect(result.positions.get('dragged')!.y).toBe(250);
    expect(result.bands[1]).toMatchObject({ y1: 100, y2: 267 });
    expect(result.bands[2]).toMatchObject({ y1: 267, y2: 367 });
    expect(result.positions.get('later')!.y).toBe(317);
    expect(result.positions.get('earlier')!.y).toBe(50);
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
