import { describe, expect, it } from 'vitest';
import {
  createSpringSystem,
  setAnchor,
  springStep,
  DEFAULT_SPRING_OPTIONS,
  HOP_WEIGHTS,
  type SpringNodeInput,
} from './springs';

/** anchor - hop1 - hop2 chain, 100 units apart along x. */
function chain(): { nodes: SpringNodeInput[]; edges: Array<[number, number]> } {
  return {
    nodes: [
      { id: 'anchor', x: 0, y: 0, weight: 0 },
      { id: 'h1', x: 100, y: 0, weight: HOP_WEIGHTS[1] },
      { id: 'h2', x: 200, y: 0, weight: HOP_WEIGHTS[2] },
    ],
    edges: [
      [0, 1],
      [1, 2],
    ],
  };
}

describe('springStep', () => {
  it('never moves the anchor', () => {
    const { nodes, edges } = chain();
    const sys = createSpringSystem(nodes, edges);
    setAnchor(sys, -300, 250);
    for (let i = 0; i < 30; i++) springStep(sys);
    expect(sys.x[0]).toBe(-300);
    expect(sys.y[0]).toBe(250);
  });

  it('pulls a hop-1 neighbor partway toward a dragged anchor', () => {
    const { nodes, edges } = chain();
    const sys = createSpringSystem(nodes, edges);
    setAnchor(sys, -300, 0); // stretched edge: rest 100, now 400
    for (let i = 0; i < 60; i++) springStep(sys);
    // Moved toward the anchor (negative x) but held back by the home restore:
    // subtle, not full rubber-sheet follow.
    expect(sys.x[1]).toBeLessThan(100);
    expect(sys.x[1]).toBeGreaterThan(-200);
    // Hop-2 moves less than hop-1 did.
    expect(Math.abs(200 - sys.x[2])).toBeLessThan(Math.abs(100 - sys.x[1]));
  });

  it('is stable: repeated steps converge instead of oscillating away', () => {
    const { nodes, edges } = chain();
    const sys = createSpringSystem(nodes, edges);
    setAnchor(sys, -300, 100);
    for (let i = 0; i < 200; i++) springStep(sys);
    const x1 = sys.x[1];
    const y1 = sys.y[1];
    springStep(sys);
    expect(Math.abs(sys.x[1] - x1)).toBeLessThan(0.5);
    expect(Math.abs(sys.y[1] - y1)).toBeLessThan(0.5);
    expect(Number.isFinite(sys.x[2])).toBe(true);
  });

  it('does nothing when the anchor has not moved', () => {
    const { nodes, edges } = chain();
    const sys = createSpringSystem(nodes, edges);
    springStep(sys);
    expect(sys.x[1]).toBeCloseTo(100, 6);
    expect(sys.x[2]).toBeCloseTo(200, 6);
  });

  it('scale near zero freezes motion (settle end state persists)', () => {
    const { nodes, edges } = chain();
    const sys = createSpringSystem(nodes, edges);
    setAnchor(sys, -300, 0);
    for (let i = 0; i < 10; i++) springStep(sys);
    const x1 = sys.x[1];
    springStep(sys, DEFAULT_SPRING_OPTIONS, 0.001);
    expect(Math.abs(sys.x[1] - x1)).toBeLessThan(0.5);
  });

  it('treats a zero-weight pair as rigid', () => {
    const sys = createSpringSystem(
      [
        { id: 'a', x: 0, y: 0, weight: 0 },
        { id: 'b', x: 50, y: 0, weight: 0 },
      ],
      [[0, 1]],
    );
    setAnchor(sys, -100, 0);
    springStep(sys);
    expect(sys.x[1]).toBe(50);
  });
});
