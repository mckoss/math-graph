import { describe, expect, it } from 'vitest';
import { sampleGraph } from './sample-graph';
import {
  applyKnowledgeRating,
  conceptIdsForTarget,
  KNOWLEDGE_STORAGE_KEY,
  loadKnowledgeRatings,
  saveKnowledgeRatings,
  summarizeKnowledgeRating,
} from './knowledge-state';

describe('knowledge self-evaluation', () => {
  it('applies a rating recursively to every concept in a group', () => {
    const ids = conceptIdsForTarget(sampleGraph, 'arithmetic');
    const ratings = applyKnowledgeRating(sampleGraph, {}, 'arithmetic', 'familiar');

    expect(ids).toEqual(['addition', 'counting', 'fractions', 'multiplication']);
    expect(Object.keys(ratings).sort()).toEqual(ids);
    expect(Object.values(ratings)).toEqual(ids.map(() => 'familiar'));
    expect(summarizeKnowledgeRating(sampleGraph, ratings, 'arithmetic')).toEqual({
      conceptCount: 4,
      ratedCount: 4,
      rating: 'familiar',
      mixed: false,
    });
  });

  it('reports mixed group knowledge without changing unrelated concepts', () => {
    const ratings = applyKnowledgeRating(
      sampleGraph,
      { addition: 'mastered', variables: 'aware' },
      'fractions',
      'familiar',
    );
    expect(ratings.variables).toBe('aware');
    expect(summarizeKnowledgeRating(sampleGraph, ratings, 'arithmetic').mixed).toBe(true);
  });

  it('round-trips valid local storage values and ignores corrupt entries', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveKnowledgeRatings(storage, { counting: 'aware', addition: 'mastered' });
    expect(loadKnowledgeRatings(storage)).toEqual({ counting: 'aware', addition: 'mastered' });

    values.set(KNOWLEDGE_STORAGE_KEY, JSON.stringify({ counting: 'invalid', addition: 'familiar' }));
    expect(loadKnowledgeRatings(storage)).toEqual({ addition: 'familiar' });
  });
});
