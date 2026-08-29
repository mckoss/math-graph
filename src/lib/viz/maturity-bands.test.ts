import { describe, expect, it } from 'vitest';
import type { ConceptGraph } from '../types';
import { assignMaturityBands, placeInMaturityBands } from './maturity-bands';

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

    expect(result.bandRects).toEqual([
      { band: 0, y1: 40, y2: 240, count: 1 },
      { band: 1, y1: 240, y2: 440, count: 0 },
      { band: 2, y1: 440, y2: 640, count: 1 },
      { band: 3, y1: 640, y2: 840, count: 0 },
    ]);
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
    expect(result.bandRects.map(({ y1 }) => y1)).toEqual([0, 100, 200]);
  });
});
