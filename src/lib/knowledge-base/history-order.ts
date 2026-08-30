import type { ConceptHistory } from '../types';

/** Earliest recorded year for a concept's development period. */
export function historyStart(history: ConceptHistory | undefined): number | undefined {
  return history?.from ?? history?.to;
}

/** Latest recorded year for a concept's development period. */
export function historyEnd(history: ConceptHistory | undefined): number | undefined {
  return history?.to ?? history?.from;
}

/**
 * True only when the recorded periods are unambiguously reversed: the
 * prerequisite begins after the dependent concept's recorded period ends.
 * Missing or overlapping periods do not claim a mismatch.
 */
export function hasHistoricalOrderMismatch(
  prerequisite: ConceptHistory | undefined,
  dependent: ConceptHistory | undefined,
): boolean {
  const prerequisiteStart = historyStart(prerequisite);
  const dependentEnd = historyEnd(dependent);
  return prerequisiteStart !== undefined &&
    dependentEnd !== undefined &&
    prerequisiteStart > dependentEnd;
}
