import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  emptyUserState,
  loadUserState,
  sanitizeUserState,
  saveUserState,
  userStorageKey,
  UserStore,
  type StorageLike,
} from './user-store';

const STORAGE_KEY = userStorageKey('default');

function memoryStorage(initial?: Record<string, string>): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

function throwingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
}

describe('sanitizeUserState', () => {
  it('turns garbage into an empty state', () => {
    expect(sanitizeUserState(null)).toEqual(emptyUserState());
    expect(sanitizeUserState('nope')).toEqual(emptyUserState());
    expect(sanitizeUserState(42)).toEqual(emptyUserState());
    expect(sanitizeUserState({ positionOffsets: 'x', bookmarks: 7, expanded: {} })).toEqual(
      emptyUserState(),
    );
  });

  it('keeps valid entries and drops invalid ones', () => {
    const s = sanitizeUserState({
      positionOffsets: { a: { dx: 1, dy: -2 }, bad: { dx: 'x', dy: 0 }, worse: null },
      bookmarks: { b: 'to-learn', c: 'have-learned', d: 'finished' },
      expanded: ['algebra', 42, 'geometry'],
    });
    expect(s.positionOffsets).toEqual({ a: { dx: 1, dy: -2 } });
    expect(s.bookmarks).toEqual({ b: 'to-learn', c: 'have-learned' });
    expect(s.expanded).toEqual(['algebra', 'geometry']);
  });

  it('keeps a valid normalized band position and clamps it to the band', () => {
    expect(sanitizeUserState({
      positionOffsets: {
        a: { dx: 1, dy: 2, bandFraction: 0.4 },
        b: { dx: 3, dy: 4, bandOffsetY: 180, bandFraction: 8 },
      },
    }).positionOffsets).toEqual({
      a: { dx: 1, dy: 2, bandFraction: 0.4 },
      b: { dx: 3, dy: 4, bandOffsetY: 180, bandFraction: 1 },
    });
  });
});

describe('load/save round trip', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const state = emptyUserState();
    state.positionOffsets.n1 = { dx: 10, dy: 20 };
    state.layoutAnchor = 'n1';
    state.bookmarks.n2 = 'to-learn';
    state.expanded = ['cat'];
    saveUserState(state, storage);
    expect(loadUserState(storage)).toEqual(state);
  });

  it('returns an empty state for missing, corrupt, or throwing storage', () => {
    expect(loadUserState(null)).toEqual(emptyUserState());
    expect(loadUserState(memoryStorage())).toEqual(emptyUserState());
    expect(loadUserState(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toEqual(emptyUserState());
    expect(loadUserState(throwingStorage())).toEqual(emptyUserState());
    expect(() => saveUserState(emptyUserState(), throwingStorage())).not.toThrow();
  });
});

describe('clampOffset', () => {
  it('passes small offsets through and caps large ones, preserving direction', () => {
    expect(clampOffset({ dx: 30, dy: 40 }, 100)).toEqual({ dx: 30, dy: 40 });
    const capped = clampOffset({ dx: 300, dy: 400 }, 100);
    expect(Math.hypot(capped.dx, capped.dy)).toBeCloseTo(100);
    expect(capped.dx / capped.dy).toBeCloseTo(300 / 400);
    expect(clampOffset({ dx: NaN, dy: 5 }, 100)).toEqual({ dx: 0, dy: 5 });
  });
});

describe('UserStore', () => {
  const seeded = () =>
    memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        positionOffsets: { ghost: { dx: 5, dy: 5 }, alive: { dx: 1, dy: 1 } },
        bookmarks: { 'ghost-2': 'have-learned' },
        expanded: ['ghost-cat', 'algebra'],
      }),
    });

  it('preserves entries for unknown ids across per-id writes', () => {
    const storage = seeded();
    const store = new UserStore(storage, 0);
    store.setOffset('new-node', { dx: 9, dy: 9 });
    store.setBookmark('another', 'to-learn');
    store.flush();
    const persisted = loadUserState(storage);
    // "ghost" ids from an older/newer graph version are still there.
    expect(persisted.positionOffsets.ghost).toEqual({ dx: 5, dy: 5 });
    expect(persisted.bookmarks['ghost-2']).toBe('have-learned');
    expect(persisted.positionOffsets['new-node']).toEqual({ dx: 9, dy: 9 });
  });

  it('setExpanded keeps stored ids outside the known-id set', () => {
    const storage = seeded();
    const store = new UserStore(storage, 0);
    // This app instance only knows about algebra + geometry.
    store.setExpanded(['geometry'], new Set(['algebra', 'geometry']));
    store.flush();
    const persisted = loadUserState(storage);
    expect(persisted.expanded.sort()).toEqual(['geometry', 'ghost-cat']);
  });

  it('clearOffsets removes all offsets but keeps bookmarks', () => {
    const storage = seeded();
    const store = new UserStore(storage, 0);
    store.clearOffsets();
    store.flush();
    const persisted = loadUserState(storage);
    expect(persisted.positionOffsets).toEqual({});
    expect(persisted.bookmarks['ghost-2']).toBe('have-learned');
  });

  it('setOffset(null) and setBookmark(null) remove entries', () => {
    const storage = seeded();
    const store = new UserStore(storage, 0);
    store.setOffset('alive', null);
    store.setBookmark('ghost-2', null);
    store.flush();
    const persisted = loadUserState(storage);
    expect(persisted.positionOffsets).toEqual({ ghost: { dx: 5, dy: 5 } });
    expect(persisted.bookmarks).toEqual({});
  });

  it('works with no storage at all', () => {
    const store = new UserStore(null, 0);
    expect(store.state).toEqual(emptyUserState());
    store.setBookmark('x', 'to-learn');
    expect(() => store.flush()).not.toThrow();
    expect(store.state.bookmarks.x).toBe('to-learn');
  });

  it('debounces writes until flush', () => {
    const storage = memoryStorage();
    const store = new UserStore(storage, 60_000);
    store.setBookmark('x', 'to-learn');
    expect(storage.data.has(STORAGE_KEY)).toBe(false);
    store.flush();
    expect(loadUserState(storage).bookmarks.x).toBe('to-learn');
  });
});
