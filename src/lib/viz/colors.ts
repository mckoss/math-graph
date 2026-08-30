/**
 * Color system for the visualization.
 *
 * Maturity labels, ordering, and colors come from the knowledge base. Color
 * has one semantic meaning throughout the graph: maturity level.
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
