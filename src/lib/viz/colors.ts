/**
 * Color system for the visualization.
 *
 * Maturity labels, ordering, and colors come from the knowledge base. Groups
 * get distinct hues here so expanded concepts retain a visual family link.
 */

import type { MaturityLevel } from '../types';

export interface MaturityPaint {
  label: string;
  /** Strong color: borders, legend swatches, badges. */
  color: string;
  /** Light tint: node fills. */
  tint: string;
}

export const UNCLASSIFIED_PAINT: MaturityPaint = {
  label: 'General',
  color: '#7c8698',
  tint: '#e8ebf0',
};

export function orderedMaturityLevels(
  levels: readonly MaturityLevel[],
): MaturityLevel[] {
  return [...levels].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function maturityPaint(
  levels: readonly MaturityLevel[],
  levelId?: string,
): MaturityPaint {
  const level = levelId === undefined ? undefined : levels.find(({ id }) => id === levelId);
  return level === undefined
    ? UNCLASSIFIED_PAINT
    : { label: level.label, color: level.color, tint: level.tint };
}

export interface GroupPaint {
  /** Strong color: group node border and text accents. */
  color: string;
  /** Light tint: group node fill. */
  tint: string;
  /** Mid tone: soft halo behind children of the expanded group. */
  halo: string;
}

/** Hand-picked group hues that read well on the light graph background. */
const GROUP_HUES = [204, 158, 262, 22, 330, 96, 240, 42, 186, 300, 66, 12];

/** Paint for the i-th group (by order of appearance in the graph). */
export function groupPaint(index: number): GroupPaint {
  const h = (GROUP_HUES[index % GROUP_HUES.length] + 9 * Math.floor(index / GROUP_HUES.length)) % 360;
  return {
    color: `hsl(${h}, 42%, 42%)`,
    tint: `hsl(${h}, 52%, 93%)`,
    halo: `hsl(${h}, 55%, 72%)`,
  };
}
