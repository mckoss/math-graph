/**
 * Color system for the visualization.
 *
 * Stages follow a warm-to-cool progression as math advances:
 * gold (elementary) -> coral (middle) -> violet (high school) -> blue (undergraduate).
 * Categories each get their own hue, used to tint their children when expanded.
 */

import type { Stage } from '../types';

export interface StagePaint {
  label: string;
  /** Strong color: borders, legend swatches, badges. */
  color: string;
  /** Light tint: node fills. */
  tint: string;
}

export const STAGE_ORDER: Stage[] = ['elementary', 'middle', 'high-school', 'undergraduate'];

export const STAGE_PAINT: Record<Stage, StagePaint> = {
  elementary: { label: 'Elementary', color: '#d9920f', tint: '#fbeccd' },
  middle: { label: 'Middle school', color: '#d95f38', tint: '#fadfd2' },
  'high-school': { label: 'High school', color: '#8256c8', tint: '#ebe1f9' },
  undergraduate: { label: 'Undergraduate', color: '#2f6fc2', tint: '#d9e6f8' },
};

export const UNSTAGED_PAINT: StagePaint = {
  label: 'General',
  color: '#7c8698',
  tint: '#e8ebf0',
};

export function stagePaint(stage?: Stage): StagePaint {
  return stage !== undefined ? STAGE_PAINT[stage] : UNSTAGED_PAINT;
}

export interface CategoryPaint {
  /** Strong color: category node border and text accents. */
  color: string;
  /** Light tint: category node fill. */
  tint: string;
  /** Mid tone: soft halo behind children of the expanded category. */
  halo: string;
}

/** Hand-picked hues that read well against the stage palette. */
const CATEGORY_HUES = [204, 158, 262, 22, 330, 96, 240, 42, 186, 300, 66, 12];

/** Paint for the i-th category (by order of appearance in the graph). */
export function categoryPaint(index: number): CategoryPaint {
  const h = (CATEGORY_HUES[index % CATEGORY_HUES.length] + 9 * Math.floor(index / CATEGORY_HUES.length)) % 360;
  return {
    color: `hsl(${h} 42% 42%)`,
    tint: `hsl(${h} 52% 93%)`,
    halo: `hsl(${h} 55% 72%)`,
  };
}
